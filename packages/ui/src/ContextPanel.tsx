import { PanelRight, TextSearch } from "lucide-react";

const SHORTCUTS: [string, string[]][] = [
	["Command menu", ["⌘", "K"]],
	["Toggle sidebar", ["`"]],
	["Show teammate calendar", ["P"]],
	["Go to date", ["."]],
	["All keyboard shortcuts", ["?"]],
];

export function ContextPanel() {
	return (
		<aside className="sch-panel">
			<div className="sch-input" style={{ left: 8, top: 8, width: 232 }}>
				<TextSearch className="sch-icon" size={18} strokeWidth={1.5} />
				<span>Search events</span>
			</div>
			<button
				type="button"
				className="sch-iconbtn"
				style={{ left: 244, top: 8 }}
				aria-label="Toggle panel"
			>
				<PanelRight className="sch-icon" size={18} strokeWidth={1.5} />
			</button>
			<div className="sch-shortcuts">
				<div className="sch-shortcuts__head">Useful shortcuts</div>
				{SHORTCUTS.map(([label, keys], i) => (
					<div
						key={label}
						className={`sch-shortcuts__item${i === 0 ? " sch-shortcuts__item--first" : ""}`}
					>
						{label}
						<span className="sch-keys">
							{keys.map((k) => (
								<kbd key={k} className="sch-kbd">
									{k}
								</kbd>
							))}
						</span>
					</div>
				))}
			</div>
		</aside>
	);
}
