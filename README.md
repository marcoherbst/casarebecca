# Evercam Open

A Codex Sites demo app that hosts ThatOpen Fragment BIM files and streams them
into a browser-based 3D viewer.

## What It Does

- Serves sample `.frag` BIM files from `public/models/`
- Serves Drive-sourced project `.frag` models from an API route (public — no sign-in required)
- Streams each file with byte progress in the UI
- Loads the streamed buffers into `@thatopen/components` `FragmentsManager`
- Shows architecture and structure models as separate BIM disciplines
- Lets you switch between the Drive projects and the demo set
- Offers 2D floor plan and elevation views (via `@thatopen/components` `Views`
  and `TechnicalDrawings`) alongside the 3D viewport

The bundled sample files come from ThatOpen's public fragment demo resources:

- `school_arq.frag`
- `school_str.frag`

## Project Sources

The Drive IFC folder is downloaded locally into `source-models/drive-ifc/`.
That folder is intentionally ignored by git and is not committed or deployed.

Run `npm run convert:ifc` after adding or replacing IFC files. The converter
uses `@thatopen/fragments` and `web-ifc` to write compressed fragments into
`protected-models/`. Vercel serves those fragments from `/api/models/:modelId`
without requiring sign-in — the fragment geometry isn't confidential.

The active protected project list lives in `modelCatalog.ts`. Each Drive IFC
gets one project entry, with the IFC base filename used as the project name.

Project display-name overrides are stored in Supabase in
`public.project_settings`. Apply the migrations in `supabase/migrations/` when
provisioning a new Supabase project.

## Authentication

Viewing and streaming models (including protected Drive-sourced projects)
requires no sign-in — the fragment files aren't confidential. The Vercel build
uses Supabase Auth for Google SSO to gate everything else: the admin panel and
project display-name management.

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
Admins can add users and assign either `admin` or `user` roles. Signed-in
non-admin users can manage nothing beyond viewing; guests (no session) get the
same viewer with no admin/project-settings controls.

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
