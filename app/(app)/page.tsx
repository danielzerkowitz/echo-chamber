export default function EmptyPane() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 border-b-8 border-wa-accent bg-wa-panel-deep text-center">
      <span className="text-7xl">💬</span>
      <h1 className="text-2xl font-light text-wa-text">Echo Chamber</h1>
      <p className="max-w-sm text-sm text-wa-text-soft">
        Create bots, chat with them one-on-one, put up to six of them in a group, or get two of them on a
        call and listen in.
      </p>
    </div>
  );
}
