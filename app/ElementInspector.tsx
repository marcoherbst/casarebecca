"use client";

import { Info, X } from "lucide-react";
import type { ItemData } from "@thatopen/fragments";

export type SelectedElement = {
  category: string | null;
  data: ItemData;
  localId: number;
  modelId: string;
  name: string | null;
};

type ElementInspectorProps = {
  element: SelectedElement;
  onClose: () => void;
};

const HIDDEN_ATTRIBUTE_KEYS = new Set(["_category", "Name"]);

function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function ElementInspector({
  element,
  onClose,
}: ElementInspectorProps) {
  const attributeEntries = Object.entries(element.data).filter(
    (entry): entry is [string, { type?: string; value: unknown }] => {
      const [key, attribute] = entry;
      return (
        !HIDDEN_ATTRIBUTE_KEYS.has(key) &&
        !Array.isArray(attribute) &&
        typeof attribute === "object" &&
        attribute !== null &&
        "value" in attribute
      );
    },
  );

  return (
    <section
      aria-label="Element properties"
      className="element-inspector-panel"
    >
      <header>
        <div>
          <span>Selected element</span>
          <h2>{element.name ?? "Unnamed element"}</h2>
          {element.category ? (
            <p className="element-category">{element.category}</p>
          ) : null}
        </div>
        <div className="element-inspector-actions">
          <Info className="icon" aria-hidden="true" />
          <button
            aria-label="Close properties panel"
            className="element-inspector-close"
            onClick={onClose}
            type="button"
          >
            <X className="icon" aria-hidden="true" />
          </button>
        </div>
      </header>

      {attributeEntries.length ? (
        <dl className="element-attribute-list">
          {attributeEntries.map(([key, attribute]) => (
            <div className="element-attribute-row" key={key}>
              <dt>{key}</dt>
              <dd>{formatAttributeValue(attribute.value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="admin-status">No additional properties available.</p>
      )}
    </section>
  );
}
