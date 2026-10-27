import type { Metadata } from "next";
import { EditClient } from "./EditClient";

export const metadata: Metadata = {
  title: "Edit PDF — PDFnesia",
  description:
    "Add text, drawings, shapes, highlights and images to your PDF right in your browser.",
};

export default function EditPage() {
  return <EditClient />;
}
