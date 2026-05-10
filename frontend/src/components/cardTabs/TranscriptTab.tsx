import { SkeletonLines } from "./Section";

interface TranscriptTabProps {
  /** `null` while loading, string (possibly empty) when fetched. */
  transcript: string | null;
}

export default function TranscriptTab({ transcript }: TranscriptTabProps) {
  return (
    <div className="text-sm leading-relaxed">
      {transcript === null ? (
        <SkeletonLines />
      ) : (
        <pre className="whitespace-pre-wrap font-sans leading-relaxed text-ink-200">
          {transcript}
        </pre>
      )}
    </div>
  );
}
