# Email Outreach - Cloud Web Application

Cloud-based email outreach application converted from the Electron desktop app.

## Features

- **Import**: Upload CSV/Excel files with lead data, auto-detect columns
- **Lead Management**: View, filter, and verify email addresses
- **Campaigns**: Create multi-step email sequences with AI personalization
- **Preview**: Generate and preview personalized emails with AI
- **Queue**: Automated email sending with rate limiting and scheduling

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: Neon Postgres (via Prisma)
- **AI**: OpenAI GPT-4 for email personalization
- **Email**: Nodemailer (SMTP)
- **Deployment**: Vercel

## Setup

### 1. Clone and Install

```bash
cd web
npm install
```

### 2. Environment Variables

Copy `.env.local` and fill in your values:

```env
# Database (Neon Postgres - get free at neon.tech)
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"

# OpenAI (for AI email generation)
OPENAI_API_KEY="sk-..."

# SMTP (your email provider)
SMTP_PASSWORD="your-app-password"

# Cron security (generate a random string)
CRON_SECRET="random-secret-string"

# Email Verification (optional)
ZEROBOUNCE_API_KEY=""
```

### 3. Database Setup

```bash
# Push schema to database
npx prisma db push

# Generate client
npx prisma generate
```

### 4. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

### 1. Create Neon Database

1. Go to [neon.tech](https://neon.tech) and create a free account
2. Create a new project
3. Copy the connection string (starts with `postgresql://`)

### 2. Deploy to Vercel

1. Push this `web` folder to a GitHub repository
2. Go to [vercel.com](https://vercel.com) and import the repository
3. Set environment variables in Vercel project settings:
   - `DATABASE_URL` - Neon connection string
   - `OPENAI_API_KEY` - Your OpenAI API key
   - `SMTP_PASSWORD` - Your SMTP password/app password
   - `CRON_SECRET` - Random string for cron job authentication
4. Deploy!

### 3. Run Database Migration

After first deployment, run:
```bash
npx prisma db push
```

Or use Vercel's build command: `npx prisma db push && next build`

## Cron Job

The app includes a Vercel Cron job that runs every minute to process the email queue. This is configured in `vercel.json`.

The cron endpoint is protected by `CRON_SECRET` - Vercel automatically passes this header.

## Project Structure

```
web/
├── app/
│   ├── page.tsx                    # Landing page
│   ├── dashboard/page.tsx          # Main dashboard
│   └── api/                        # API routes
├── components/
│   └── dashboard/                  # Dashboard step components
├── lib/
│   ├── db.ts                       # Prisma client
│   ├── ai.ts                       # OpenAI integration
│   ├── verify.ts                   # Email verification
│   └── parser.ts                   # CSV/Excel parsing
├── prisma/
│   └── schema.prisma               # Database schema
└── vercel.json                     # Vercel config (cron)
```

## SMTP Setup

### Gmail

1. Enable 2FA on your Google account
2. Create an App Password: Google Account → Security → App passwords
3. Use your Gmail address as SMTP_USER
4. Use the App Password as SMTP_PASSWORD
5. Host: smtp.gmail.com, Port: 465, Secure: true

### Other Providers

Configure the SMTP settings in the Connect step of the dashboard.
