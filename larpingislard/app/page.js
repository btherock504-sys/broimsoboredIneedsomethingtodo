"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const COLORS = ["#ef4444", "#f97316", "#ca8a04", "#16a34a", "#0d9488", "#2563eb", "#7c3aed", "#db2777"];
const colorFor = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const nameOf = (email = "") => email.split("@")[0];
const time = (d) => new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayKey = (d) => new Date(d).toDateString();
const dayLabel = (d) => {
  const t = new Date(); const y = new Date(Date.now() - 864e5);
  if (dayKey(d) === t.toDateString()) return "Today";
  if (dayKey(d) === y.toDateString()) return "Yesterday";
  return new Date(d).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
};
const linkify = (t) => t.split(/(https?:\/\/\S+)/g).map((p, i) =>
  /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p);
const TITLES = { chat: "Chat", doc: "Q3 Planning – Docs", log: "build-output – Logs", ai: "New chat" };
const HEADS = { chat: "Chat", doc: "Q3 Planning", log: "build-output", ai: "New chat" };
const ICONS = { chat: "💬", doc: "📄", log: "🖥️", ai: "✨" };
const HINTS = { chat: "Message (Enter to send, Shift+Enter for new line)", doc: "Add a comment…", log: "$ ", ai: "How can I help you today?" };
function setIcon(emoji, dot) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${emoji}</text>${dot ? "<circle cx='80' cy='20' r='18' fill='red'/>" : ""}</svg>`;
  let l = document.querySelector("link[rel=icon]");
  if (!l) { l = document.createElement("link"); l.rel = "icon"; document.head.appendChild(l); }
  l.href = "data:image/svg+xml," + encodeURIComponent(svg);
}
function beep() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.05;
    o.start(); o.stop(c.currentTime + 0.12);
  } catch {}
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [online, setOnline] = useState([]);
  const [typing, setTyping] = useState({});
  const [unread, setUnread] = useState(0);
  const [alerts, setAlerts] = useState(false);
  const [theme, setTheme] = useState("chat");
  const [shy, setShy] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [hover, setHover] = useState(false);
  const [blur, setBlur] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const live = useRef(false), seen = useRef(0);
  const feed = useRef(null), bottom = useRef(null), chRef = useRef(null), lastTyped = useRef(0);
  const alertsRef = useRef(true), atBottomRef = useRef(true);
  useEffect(() => {
    try { setTheme(localStorage.getItem("theme") || "chat"); setShy(localStorage.getItem("shy") === "1"); } catch {}
  }, []);
  const cycleTheme = () => {
    const next = { chat: "doc", doc: "log", log: "ai", ai: "chat" }[theme]; setTheme(next);
    try { localStorage.setItem("theme", next); } catch {}
  };
  const toggleShy = () => { setShy(!shy); try { localStorage.setItem("shy", !shy ? "1" : "0"); } catch {} };
  alertsRef.current = alerts; atBottomRef.current = atBottom;
  const me = session?.user?.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    const myId = session.user.id, myEmail = session.user.email;
    supabase.from("messages").select("*").order("created_at", { ascending: true }).limit(300)
      .then(({ data }) => { setMessages(data || []); seen.current = data?.length ? data[data.length - 1].id : 0; });

    const ch = supabase.channel("room", { config: { presence: { key: myId } } });
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, ({ new: m }) => {
      seen.current = Math.max(seen.current, m.id);
      setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]));
      if (m.user_id === myId) return;
      if (document.hidden || !atBottomRef.current) setUnread((n) => n + 1);
      if (alertsRef.current && document.hidden) {
        beep();
        if (typeof Notification !== "undefined" && Notification.permission === "granted")
          new Notification(nameOf(m.user_email), { body: m.content });
      }
    })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" },
        ({ old }) => setMessages((ms) => ms.filter((x) => x.id !== old.id)))
      .on("presence", { event: "sync" }, () =>
        setOnline(Object.entries(ch.presenceState()).map(([id, v]) => ({ id, email: v[0]?.email }))))
      .on("broadcast", { event: "typing" }, ({ payload }) =>
        setTyping((t) => ({ ...t, [payload.id]: { name: payload.name, at: Date.now() } })))
      .subscribe(async (status) => {
        live.current = status === "SUBSCRIBED";
        if (live.current) await ch.track({ email: myEmail });
      });

    // fallback: if the live connection is blocked, poll for new messages
    const poll = setInterval(async () => {
      if (live.current) return;
      const { data } = await supabase.from("messages").select("*").order("created_at", { ascending: true }).limit(300);
      if (!data) return;
      const fresh = data.filter((m) => m.id > seen.current && m.user_id !== myId);
      if (fresh.length && document.hidden) setUnread((n) => n + fresh.length);
      if (data.length) seen.current = Math.max(seen.current, data[data.length - 1].id);
      setMessages((ms) => (ms.length === data.length && ms[ms.length - 1]?.id === data[data.length - 1]?.id ? ms : data));
    }, 4000);
    chRef.current = ch;

    const tick = setInterval(() => setTyping((t) => {
      const n = {}; for (const k in t) if (Date.now() - t[k].at < 3000) n[k] = t[k];
      return Object.keys(n).length === Object.keys(t).length ? t : n;
    }), 1000);
    return () => { clearInterval(tick); clearInterval(poll); supabase.removeChannel(ch); };
  }, [session]);

  useEffect(() => {
    const onVis = () => { if (!document.hidden && atBottomRef.current) setUnread(0); };
    const onKey = (e) => { if (e.key === "Escape") setBlur((b) => !b); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => {
    const base = blur ? "Docs" : TITLES[theme];
    document.title = theme === "chat" && unread ? `(${unread}) ${base}` : base;
    setIcon(blur ? "📄" : ICONS[theme], unread > 0);
  }, [unread, blur, theme]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (atBottomRef.current || last?.user_id === me) bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, me]);

  function onScroll() {
    const el = feed.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(near); if (near && !document.hidden) setUnread(0);
  }

  async function login(e) {
    e.preventDefault(); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  }

  async function send(e) {
    e?.preventDefault();
    const content = text.trim(); if (!content) return;
    setText(""); setError("");
    const { error } = await supabase.from("messages").insert({ content, user_email: session.user.email });
    if (error) setError(error.message);
  }

  function onType(e) {
    setText(e.target.value);
    e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px";
    if (Date.now() - lastTyped.current > 2000) {
      lastTyped.current = Date.now();
      chRef.current?.send({ type: "broadcast", event: "typing", payload: { id: me, name: nameOf(session.user.email) } });
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); e.target.style.height = "auto"; }
  }

  async function toggleAlerts() {
    const next = !alerts; setAlerts(next);
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
  }

  if (!ready) return null;

  if (!session) {
    return (
      <div className="hero">
        <button className="logo" onClick={() => setShowLogin((v) => !v)} aria-label="Open">
          <svg viewBox="0 0 200 200" width="100%" height="100%">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#6366f1" />
                <stop offset="1" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <circle cx="100" cy="100" r="92" fill="url(#g)" />
            <path d="M60 110 Q100 40 140 110 Q100 150 60 110Z" fill="none" stroke="#fff" strokeWidth="9" strokeLinejoin="round" />
            <circle cx="100" cy="102" r="12" fill="#fff" />
          </svg>
        </button>
        {showLogin && (
          <form className="login" onSubmit={login}>
            <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button>Sign in</button>
            {error && <span className="err">{error}</span>}
          </form>
        )}
      </div>
    );
  }

  const typers = Object.entries(typing).filter(([id]) => id !== me).map(([, v]) => v.name);
  const others = online.filter((u) => u.id !== me);

  return (
    <div className={"app t-" + theme}>
      <header className="top">
        <div>
          <div className="title">{HEADS[theme]}</div>
          <div className="sub"><span className="dot" />{online.length} online{others.length ? ` · ${others.map((u) => nameOf(u.email)).join(", ")}` : ""}</div>
        </div>
        <div className="grow" />
        <button className={"ghost" + (alerts ? " on" : "")} onClick={toggleAlerts} title="Sound and desktop alerts">{alerts ? "🔔" : "🔕"}</button>
        <button className={"ghost" + (theme !== "chat" ? " on" : "")} onClick={cycleTheme} title="Disguise: chat / doc / log / AI">🎭</button>
        <button className={"ghost" + (shy ? " on" : "")} onClick={toggleShy} title="Blur until you hover over the chat">👁️</button>
        <button className={"ghost" + (blur ? " on" : "")} onClick={() => setBlur((b) => !b)} title="Blur chat (Esc)">🙈</button>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <main className={"feed" + (blur || (shy && !hover) ? " blur" : "")} ref={feed} onScroll={onScroll}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {messages.length === 0 && <div className="empty">No messages yet. Say hi 👋</div>}
        {messages.map((m, i) => {
          const prev = messages[i - 1], mine = m.user_id === me;
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const first = newDay || prev.user_id !== m.user_id || new Date(m.created_at) - new Date(prev.created_at) > 3e5;
          const next = messages[i + 1];
          const last = !next || next.user_id !== m.user_id || dayKey(next.created_at) !== dayKey(m.created_at) || new Date(next.created_at) - new Date(m.created_at) > 3e5;
          return (
            <div key={m.id} style={{ display: "contents" }}>
              {newDay && <div className="day">{dayLabel(m.created_at)}</div>}
              <div className={"row" + (mine ? " me" : "") + (first ? " first" : "")}>
                {!mine && (last
                  ? <div className="av" style={{ background: colorFor(m.user_email) }}>{nameOf(m.user_email)[0]?.toUpperCase()}</div>
                  : <div className="sp" />)}
                <div>
                  {!mine && first && <div className="who">{nameOf(m.user_email)}</div>}
                  <div className="bub">{linkify(m.content)}</div>
                  {last && (
                    <div className="meta">
                      <span>{time(m.created_at)}</span>
                      {mine && <button className="del" onClick={() => supabase.from("messages").delete().eq("id", m.id)}>delete</button>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
        {!atBottom && (
          <button className="jump" onClick={() => bottom.current?.scrollIntoView({ behavior: "smooth" })}>
            ↓ {unread ? `${unread} new` : "Latest"}
          </button>
        )}
      </main>

      <div className="typing">{typers.length ? `${typers.join(", ")} ${typers.length > 1 ? "are" : "is"} typing…` : ""}</div>
      <form className="compose" onSubmit={send}>
        <textarea rows={1} value={text} onChange={onType} onKeyDown={onKeyDown} placeholder={HINTS[theme]} />
        <button>{theme === "ai" ? "↑" : "Send"}</button>
      </form>
      {error && <span className="err" style={{ padding: "0 14px 10px" }}>{error}</span>}
    </div>
  );
}
