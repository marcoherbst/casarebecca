# Evercam Open

A Codex Sites demo app that hosts ThatOpen Fragment BIM files and streams them
into a browser-based 3D viewer.

## What It Does

- Serves sample `.frag` BIM files from `public/models/`
- Protects Drive-sourced project `.frag` models behind a Supabase-authenticated API route
- Streams each file with byte progress in the UI
- Loads the streamed buffers into `@thatopen/components` `FragmentsManager`
- Shows architecture and structure models as separate BIM disciplines
- Lets you switch between the Drive projects and the demo set

The bundled sample files come from ThatOpen's public fragment demo resources:

- `school_arq.frag`
- `school_str.frag`

## Project Sources

The Drive IFC folder is downloaded locally into `source-models/drive-ifc/`.
That folder is intentionally ignored by git and is not committed or deployed.

Run `npm run convert:ifc` after adding or replacing IFC files. The converter
uses `@thatopen/fragments` and `web-ifc` to write compressed fragments into
`protected-models/`. Vercel serves those fragments from `/api/models/:modelId`
only after Supabase verifies the signed-in user.

The active protected project list lives in `modelCatalog.ts`. Each Drive IFC
gets one project entry, with the IFC base filename used as the project name.

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
npm run convert:ifc
npm run lint
```

## Public Vercel Deployment

Vercel uses `vercel.json` to force the project framework to `Other` and build a
static Vite version of the viewer into `dist-vercel/`. The raw conversion
workspace in `source-models/` is excluded from Vercel uploads. The protected
fragments are bundled only with the authenticated model API function.

## Stack

- Next/Vinext app router
- Codex Sites compatible Worker build
- `@thatopen/components`
- `@thatopen/fragments`
- Supabase Auth
- Three.js
