# Casa Rebecca BIM Streamer

A Codex Sites demo app that hosts ThatOpen Fragment BIM files and streams them
into a browser-based 3D viewer.

## What It Does

- Serves sample `.frag` BIM files from `public/models/`
- Protects the Casa Rebecca `.frag` model behind a Supabase-authenticated API route
- Streams each file with byte progress in the UI
- Loads the streamed buffers into `@thatopen/components` `FragmentsManager`
- Shows architecture and structure models as separate BIM disciplines
- Lets you switch between the streamable demo set and Casa Rebecca

The bundled sample files come from ThatOpen's public fragment demo resources:

- `school_arq.frag`
- `school_str.frag`

## Casa Rebecca Source

The provided Casa Rebecca Google Drive file is `Kilpoole House Project.rvt`, a
431 MB Autodesk Revit project. The RVT was downloaded locally to inspect the
file type, but the raw RVT is intentionally ignored via `source-models/` and is
not committed or deployed.

The `Kilpoole House Project ifc4.ifc` export parses successfully with
`web-ifc` and has been converted into `protected-models/casa_rebecca.frag` for
the viewer. Vercel serves it from `/api/models/casa_rebecca` only after
Supabase verifies the signed-in user.

## Authentication

The Vercel build uses Supabase Auth for Google SSO and app-level roles.

Required Vercel environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ADMIN_EMAILS=admin@example.com
```

`SUPABASE_ADMIN_EMAILS` is a comma-separated bootstrap list. Those users can
open the admin panel even before their Supabase `app_metadata.role` is set.
Admins can add users and assign either `admin` or `user` roles. Normal users can
load the viewer but cannot call the user-management APIs.

In Supabase, enable Google as the OAuth provider, set the Site URL to the Vercel
production URL, and add the same URL to Redirect URLs. To keep access
admin-controlled, disable open email/password signups and use the app's admin
user flow.

## Commands

```bash
npm install
npm run dev
npm run build
npm run build:vercel
npm run lint
```

## Public Vercel Deployment

Vercel uses `vercel.json` to force the project framework to `Other` and build a
static Vite version of the viewer into `dist-vercel/`. The raw conversion
workspace in `source-models/` is excluded from Vercel uploads. The protected
Casa Rebecca fragment is bundled only with the authenticated model API function.

## Stack

- Next/Vinext app router
- Codex Sites compatible Worker build
- `@thatopen/components`
- `@thatopen/fragments`
- Supabase Auth
- Three.js
