
import { useMemo, useState } from "react";
import "./SqlInsertGenerator.css";

type InsertMode = "multi" | "single";
type CustomColumn = {
  id: number;
  name: string;
  value: string;
  type: "text" | "number" | "null";
};

function parseText(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  if (!lines.length) return [];

  const delimiter = lines.some((line) => line.includes("\t"))
    ? "\t"
    : lines.some((line) => line.includes("|"))
      ? "|"
      : ",";

  return lines.map((line) => {
    const cells: string[] = [];
    let value = "";
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (char === delimiter && !quoted) {
        cells.push(value.trim());
        value = "";
      } else {
        value += char;
      }
    }

    cells.push(value.trim());
    return cells;
  });
}

function quoteIdentifier(identifier: string): string {
  return `[${identifier.trim().replace(/]/g, "]]")}]`;
}

function quoteTableName(name: string): string {
  return name
    .trim()
    .split(".")
    .map((part) => quoteIdentifier(part))
    .join(".");
}

function formatValue(value: string, emptyAsNull: boolean): string {
  const v = value.trim();

  if (v === "") return emptyAsNull ? "NULL" : "''";
  if (v.toUpperCase() === "NULL") return "NULL";

  if (/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v)) {
    return v;
  }

  return `'${v.replace(/'/g, "''")}'`;
}

function formatCustomValue(column: CustomColumn): string {
  if (column.type === "null") return "NULL";

  if (column.type === "number") {
    const value = column.value.trim();

    if (!/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
      throw new Error(
        `Custom column "${column.name}" must contain a valid number.`
      );
    }

    return value;
  }

  return `'${column.value.replace(/'/g, "''")}'`;
}

export default function SqlInsertGenerator() {
  const [table, setTable] = useState("dbo.YourTable");
  const [input, setInput] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [emptyAsNull, setEmptyAsNull] = useState(true);
  const [mode, setMode] = useState<InsertMode>("single");
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);
  const [nextId, setNextId] = useState(1);
  const [error, setError] = useState("");

  const parsed = useMemo(() => parseText(input), [input]);

  const headers = useMemo(() => {
    if (!parsed.length) return [];
    if (hasHeader) return parsed[0];

    return parsed[0].map((_, i) => `Column${i + 1}`);
  }, [parsed, hasHeader]);

  const rows = useMemo(() => {
    if (!parsed.length) return [];
    return hasHeader ? parsed.slice(1) : parsed;
  }, [parsed, hasHeader]);

  const result = useMemo(() => {
    try {
      setError("");

      if (!table.trim() || !headers.length || !rows.length) return "";

      if (table.trim().split(".").some((part) => !part.trim())) {
        throw new Error("Enter a valid table name.");
      }

      const validHeaders = headers.map(
        (header, i) => header.trim() || `Column${i + 1}`
      );

      const activeCustomColumns = customColumns.filter(
        (column) => column.name.trim() !== ""
      );

      const allNames = [
        ...validHeaders,
        ...activeCustomColumns.map((column) => column.name.trim()),
      ];

      const normalizedNames = allNames.map((name) => name.toLowerCase());

      if (new Set(normalizedNames).size !== normalizedNames.length) {
        throw new Error(
          "Duplicate column names detected. Check the pasted and custom columns."
        );
      }

      const columnList = allNames.map(quoteIdentifier).join(", ");
      const tableName = quoteTableName(table);

      const valueRows = rows
        .filter((row) => row.some((cell) => cell.trim() !== ""))
        .map((row) => {
          const values = validHeaders.map((_, i) =>
            formatValue(row[i] ?? "", emptyAsNull)
          );

          for (const column of activeCustomColumns) {
            values.push(formatCustomValue(column));
          }

          return values;
        });

      if (!valueRows.length) return "";

      if (mode === "single") {
        const batchSize = 900;
        const statements: string[] = [];

        for (let i = 0; i < valueRows.length; i += batchSize) {
          const batch = valueRows.slice(i, i + batchSize);

          statements.push(
            `INSERT INTO ${tableName} (${columnList})\nVALUES\n${batch
              .map((values) => `    (${values.join(", ")})`)
              .join(",\n")};`
          );
        }

        return statements.join("\n\n");
      }

      return `INSERT INTO ${tableName} (${columnList})\nVALUES\n${valueRows
        .map((values) => `    (${values.join(", ")})`)
        .join(",\n")};`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to generate SQL.");
      return "";
    }
  }, [table, headers, rows, customColumns, mode, emptyAsNull]);

  function addCustomColumn() {
    setCustomColumns((current) => [
      ...current,
      { id: nextId, name: "", value: "", type: "text" },
    ]);
    setNextId((id) => id + 1);
  }

  function updateCustomColumn(
    id: number,
    field: keyof Omit<CustomColumn, "id">,
    value: string
  ) {
    setCustomColumns((current) =>
      current.map((column) =>
        column.id === id ? { ...column, [field]: value } : column
      )
    );
  }

  function removeCustomColumn(id: number) {
    setCustomColumns((current) =>
      current.filter((column) => column.id !== id)
    );
  }

  async function copySql() {
    if (!result) return;

    try {
      await navigator.clipboard.writeText(result);
      alert("SQL copied to clipboard!");
    } catch {
      alert("Clipboard access failed. Select and copy the SQL manually.");
    }
  }

  return (
    <main className="sql-tool">
      <h1>SQL INSERT Generator</h1>
      <p>Paste SQL Server or Excel data and generate INSERT statements.</p>

      <label htmlFor="tableName">Destination table</label>
      <input
        id="tableName"
        value={table}
        onChange={(e) => setTable(e.target.value)}
        placeholder="dbo.YourTable"
      />

      <label htmlFor="sourceData">Paste table data</label>
      <textarea
        id="sourceData"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={"ID\tName\tMarks\n1\tRahul\t85\n2\tPriya\t92"}
        rows={8}
        spellCheck={false}
      />

      <div className="sql-options">
        <label>
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(e) => setHasHeader(e.target.checked)}
          />
          First row contains column names
        </label>

        <label>
          <input
            type="checkbox"
            checked={emptyAsNull}
            onChange={(e) => setEmptyAsNull(e.target.checked)}
          />
          Treat empty cells as NULL
        </label>
      </div>

      <section className="custom-section">
        <div className="custom-heading">
          <div>
            <h2>Custom Columns</h2>
            <p>Add columns with the same value for every row.</p>
          </div>

          <button type="button" onClick={addCustomColumn}>
            + Add Custom Column
          </button>
        </div>

        {customColumns.map((column) => (
          <div className="custom-row" key={column.id}>
            <input
              aria-label="Custom column name"
              value={column.name}
              onChange={(e) =>
                updateCustomColumn(column.id, "name", e.target.value)
              }
              placeholder="Column name (e.g. ToAddress)"
            />

            <select
              aria-label="Custom column value type"
              value={column.type}
              onChange={(e) =>
                updateCustomColumn(
                  column.id,
                  "type",
                  e.target.value as CustomColumn["type"]
                )
              }
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="null">NULL</option>
            </select>

            {column.type !== "null" && (
              <input
                aria-label="Custom column fixed value"
                value={column.value}
                onChange={(e) =>
                  updateCustomColumn(column.id, "value", e.target.value)
                }
                placeholder={
                  column.type === "number" ? "e.g. 100" : "e.g. Mandya"
                }
              />
            )}

            <button
              type="button"
              className="remove-column"
              onClick={() => removeCustomColumn(column.id)}
            >
              Remove
            </button>
          </div>
        ))}

        {customColumns.length === 0 && (
          <p className="custom-empty">
            No custom columns added. Click "+ Add Custom Column" to begin.
          </p>
        )}
      </section>

      <label htmlFor="insertMode">INSERT format</label>
      <select
        id="insertMode"
        value={mode}
        onChange={(e) => setMode(e.target.value as InsertMode)}
      >
        <option value="multi">Single INSERT with multiple rows</option>
        <option value="single">Separate INSERT for each row</option>
      </select>

      <div className="sql-summary">
        <span>Columns: {headers.length + customColumns.filter(c => c.name.trim()).length}</span>
        <span>Data rows: {rows.length}</span>
      </div>

      <div className="sql-output-heading">
        <h2>Generated SQL</h2>
        <button onClick={copySql} disabled={!result}>
          Copy SQL
        </button>
      </div>

      {error && <p className="sql-error">{error}</p>}

      <textarea
        className="sql-result"
        value={result}
        readOnly
        rows={12}
        placeholder="Generated INSERT query appears here..."
        spellCheck={false}
      />

      <button
        type="button"
        className="sql-clear"
        onClick={() => setInput("")}
      >
        Clear pasted data
      </button>

      <p className="sql-note">
        Review column names, data types and identity columns before executing.
        Custom values are repeated for every non-empty data row.
      </p>
    </main>
  );
}
