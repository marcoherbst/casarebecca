"use client";

import { Eye, ListTree } from "lucide-react";

export type CategoryTreeEntry = {
  category: string;
  count: number;
  visible: boolean;
};

type CategoryTreeProps = {
  entries: CategoryTreeEntry[];
  onIsolate: (category: string) => void;
  onShowAll: () => void;
  onToggle: (category: string) => void;
};

export default function CategoryTree({
  entries,
  onIsolate,
  onShowAll,
  onToggle,
}: CategoryTreeProps) {
  const hasHidden = entries.some((entry) => !entry.visible);

  return (
    <section aria-label="Model categories" className="category-tree-panel">
      <header>
        <div>
          <span>Categories</span>
          <h2>Model elements</h2>
        </div>
        <ListTree className="icon" aria-hidden="true" />
      </header>

      {entries.length ? (
        <>
          <button
            className="category-tree-show-all"
            disabled={!hasHidden}
            onClick={onShowAll}
            type="button"
          >
            Show all
          </button>
          <ul className="category-tree-list">
            {entries.map((entry) => (
              <li className="category-tree-row" key={entry.category}>
                <label>
                  <input
                    checked={entry.visible}
                    onChange={() => onToggle(entry.category)}
                    type="checkbox"
                  />
                  <span>{entry.category}</span>
                  <small>{entry.count}</small>
                </label>
                <button
                  aria-label={`Isolate ${entry.category}`}
                  className="category-tree-isolate"
                  onClick={() => onIsolate(entry.category)}
                  title="Show only this category"
                  type="button"
                >
                  <Eye className="icon" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="admin-status">No categories available yet.</p>
      )}
    </section>
  );
}
