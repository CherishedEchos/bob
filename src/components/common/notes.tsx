"use client";

import * as React from "react";
import { Mic, Square, StickyNote } from "lucide-react";
import { useSpeechRecognition } from "@/lib/voice/use-speech";
import type { Note } from "@/lib/types";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import type { Result } from "@/lib/store/store";
import { timeAgo } from "@/lib/utils";

export function NotesPanel({ notes, onAdd, placeholder = "Add a note…", dictate = false }: { notes: Note[]; onAdd: (text: string) => Promise<Result<Note>>; placeholder?: string; dictate?: boolean }) {
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Dictation fills the box; nothing is saved until "Add note" (so a mishearing can be fixed first).
  const append = (heard: string) => heard && setText((t) => (t.trim() ? `${t.trim()} ${heard}` : heard));
  const speech = useSpeechRecognition({ onAutoSend: append, onManualStop: append });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await onAdd(text);
    setSaving(false);
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
          placeholder={speech.listening ? "Listening…" : placeholder}
          aria-label="New note"
          aria-invalid={!!error}
          className="min-h-20"
        />
        {speech.interim ? <p className="text-[15px] italic text-muted-foreground">{speech.interim}</p> : null}
        {error ? <p className="text-[15px] text-danger-fg">{error}</p> : null}
        {speech.error ? <p className="text-[14.5px] text-danger-fg">{speech.error}</p> : null}
        <div className="flex justify-end gap-2">
          {dictate && speech.supported ? (
            <Button type="button" size="sm" variant={speech.listening ? "default" : "ghost"} onClick={() => (speech.listening ? speech.stop() : speech.start())} aria-label={speech.listening ? "Stop dictating" : "Dictate a note"}>
              {speech.listening ? <Square /> : <Mic />} {speech.listening ? "Stop" : "Speak"}
            </Button>
          ) : null}
          <Button type="submit" size="sm" variant="secondary" disabled={!text.trim() || saving}>
            <StickyNote /> {saving ? "Saving…" : "Add note"}
          </Button>
        </div>
      </form>
      {notes.length ? (
        <ul className="mt-2 divide-y divide-line">
          {notes.map((n) => (
            <li key={n.id} className="py-3">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{n.text}</p>
              <p className="mt-1.5 text-[14px] text-subtle">
                {n.author} · {timeAgo(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[15px] text-subtle">No notes yet.</p>
      )}
    </div>
  );
}
