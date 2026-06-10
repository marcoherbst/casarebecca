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

## Casa Rebecca Source

The provided Casa Rebecca Google Drive file is `Kilpoole House Project.rvt`,
a 431 MB Autodesk Revit project. It was downloaded locally to inspect the file
type, but the raw RVT is intentionally ignored via `source-models/` and is not
committed or deployed.

ThatOpen's browser pipeline streams Fragment files generated from IFC data. To
make Casa Rebecca streamable in this app, export the RVT to IFC with Revit,
Autodesk Platform Services, or another RVT-to-IFC converter, then convert the
IFC to `.frag`.

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
