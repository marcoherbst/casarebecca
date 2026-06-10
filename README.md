# Casa Rebecca BIM Streamer

A Codex Sites demo app that hosts ThatOpen Fragment BIM files and streams them
into a browser-based 3D viewer.

## What It Does

- Serves sample `.frag` BIM files from `public/models/`
- Streams each file with byte progress in the UI
- Loads the streamed buffers into `@thatopen/components` `FragmentsManager`
- Shows architecture and structure models as separate BIM disciplines

The bundled sample files come from ThatOpen's public fragment demo resources:

- `school_arq.frag`
- `school_str.frag`

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
