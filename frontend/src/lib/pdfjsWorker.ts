// Configures react-pdf's pdfjs worker to load from a Vite-emitted asset URL.
// Imported once at app bootstrap (main.tsx) so the worker is ready before
// any <Document> component mounts.
import { pdfjs } from "react-pdf";
// `?url` is a Vite primitive that resolves the import to a public asset URL.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
