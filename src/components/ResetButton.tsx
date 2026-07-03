// Small confirm-then-reset button used by each activity. Resets delete shared
// data, so we always confirm first.
export function ResetButton({
  label = 'Reset',
  confirm,
  onReset,
}: {
  label?: string
  confirm: string
  onReset: () => void
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (window.confirm(confirm)) onReset()
      }}
      className="text-xs text-stone-400 hover:text-red-500 rounded-lg px-2 py-1 hover:bg-red-50 transition"
    >
      ↺ {label}
    </button>
  )
}
