# Casa Rebecca BIM Streamer

A Codex Sites demo app that hosts ThatOpen Fragment BIM files and streams them
into a browser-based 3D viewer.

## What It Does

- Serves sample `.frag` BIM files from `public/models/`
- Streams each file with byte progress in the UI
- Loads the streamed buffers into `@thatopen/components` `FragmentsManager`
- Shows architecture and structure models as separate BIM disciplines
- Lets you switch between the streamable demo set and a Casa Rebecca model slot

The bundled sample files come from ThatOpen's public fragment demo resources:

- `school_arq.frag`
- `school_str.frag`
- `casa_rebecca.frag`

## Casa Rebecca Source

The provided Casa Rebecca Google Drive file is `Kilpoole House Project.rvt`, a
431 MB Autodesk Revit project. The RVT was downloaded locally to inspect the
file type, but the raw RVT is intentionally ignored via `source-models/` and is
not committed or deployed.

The `Kilpoole House Project ifc4.ifc` export parses successfully with
`web-ifc` and has been converted into `public/models/casa_rebecca.frag` for the
viewer. The app streams that Fragment file from the Casa Rebecca tab.

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
```

## Stack

- Next/Vinext app router
- Codex Sites compatible Worker build
- `@thatopen/components`
- `@thatopen/fragments`
- Three.js
