type EngineerSignatureProps = {
  compact?: boolean;
  className?: string;
};

export default function EngineerSignature({ compact = false, className = "" }: EngineerSignatureProps) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 ${className}`}
      title="Ahmad Hanani"
    >
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-emerald-500 text-[10px] font-bold text-white">
        AH
      </div>
      <span className={`font-medium tracking-wide text-slate-200 ${compact ? "text-xs" : "text-sm"}`}>Ahmad Hanani</span>
    </div>
  );
}
