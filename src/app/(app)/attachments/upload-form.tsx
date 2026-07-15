"use client";

import { useState } from "react";
import { FileDropzone } from "@/components/file-dropzone";

type TopicOption = { id: string; title: string; status: string };

export function AttachmentUploadForm({ topics }: { topics: TopicOption[] }) {
  const [topicId, setTopicId] = useState("");

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="topic_id">Topic</label>
        <select
          id="topic_id"
          value={topicId}
          onChange={(e) => setTopicId(e.target.value)}
          className="input"
        >
          <option value="">— Select a topic —</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} ({t.status})
            </option>
          ))}
        </select>
      </div>

      {topicId ? (
        <FileDropzone
          endpoint="/api/attachments/upload"
          extraFields={{ topic_id: topicId }}
          hint="Drop files here to attach to the topic"
        />
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center text-sm text-muted">
          Pick a topic above to enable uploads.
        </div>
      )}
    </div>
  );
}
