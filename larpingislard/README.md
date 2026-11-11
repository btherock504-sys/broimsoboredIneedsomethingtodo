# Private chat room

## 1. Supabase (free)
1. Create a project at supabase.com.
2. SQL Editor: paste and run `schema.sql`.
3. Authentication > Users > Add user: create an account for you and each person you want in (tick "Auto confirm").
4. Authentication > Sign In / Providers: turn OFF "Allow new users to sign up" so only people you add can get in.
5. Project Settings > API: copy the Project URL and the anon public key.

Already ran the old schema? Just run the last block of `schema.sql` (the "delete own" policy).

## 2. Run locally
    cp .env.example .env.local   # paste the two values
    npm install
    npm run dev

## 3. Deploy to Vercel
1. Push this folder to a GitHub repo.
2. vercel.com > Add New > Project > import the repo.
3. Add the two env vars from .env.local under Environment Variables.
4. Deploy.
