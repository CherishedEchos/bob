"use client";

import * as React from "react";
import { StickyNote } from "lucide-react";
import type { Note } from "@/lib/types";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import type { Result } from "@/lib/store/store";
import { timeAgo } from "@/lib/utils";

export function NotesPanel({ notes, onAdd }: { notes: Note[]; onAdd: (text: string) => Result<Note> }) {
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = onAdd(text);
    if (res.ok) {
      setText("");
      setError(null);
      toast("Note added");
    } else {
      setError(Object.values(res.errors)[0] ?? "Couldn't add note");
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note…"
          aria-label="New note"
          aria-invalid={!!error}
          className="min-h-20"
        />
        {error ? <p className="text-[13px] text-red-300">{error}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant="secondary" disabled={!text.trim()}>
            <StickyNote /> Add note
          </Button>
        </div>
      </form>
      {notes.length ? (
        <ul className="mt-3 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-xl bg-white/[0.03] px-3.5 py-3 ring-1 ring-white/[0.06]">
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{n.text}</p>
              <p className="mt-1.5 text-[12px] text-subtle">
                {n.author} · {timeAgo(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-subtle">No notes yet.</p>
      )}
    </div>
  );
}
