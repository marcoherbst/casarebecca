// Stub for the "web-ifc" package in the browser bundle.
//
// @thatopen/fragments statically imports the whole web-ifc package
// (`import * as WEBIFC from "web-ifc"`) even though its APIs are only used by
// the IFC-to-Fragments conversion path. This app never converts IFC in the
// browser — that only happens offline via scripts/convert-drive-ifcs.mjs,
// which imports web-ifc directly and is unaffected by this alias. Stubbing
// it out of the client bundle removes ~3.4MB (~550kB gzip) of unused
// emscripten/WASM glue that would otherwise ship to every visitor.
export {};
