import type { ViewKind } from "@schedee/core";
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MONTH = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

export const monthName = (m: number) => MONTH[m - 1] ?? "";

const VIEW_ITEMS: {
	label: string;
	kind: ViewKind;
	count?: number;
	key: string;
}[] = [
	{ label: "Day", kind: "day", key: "D" },
	{ label: "Week", kind: "week", key: "W" },
	{ label: "Month", kind: "month", key: "M" },
	...[2, 3, 4, 5, 6].map((n) => ({
		label: `${n} days`,
		kind: "days" as ViewKind,
		count: n,
		key: String(n),
	})),
];

export interface HeaderProps {
	viewLabel: string;
	month: number;
	year: number;
	/** ISO week number shown next to the title; omitted in month view. */
	week?: number;
	/** Month view navigates vertically. */
	vertical?: boolean;
	avatarInitials?: string;
	onToday: () => void;
	onStep: (dir: 1 | -1) => void;
	onView: (kind: ViewKind, count?: number) => void;
}

export function Header({
	viewLabel,
	month,
	year,
	week,
	vertical,
	avatarInitials = "",
	onToday,
	onStep,
	onView,
}: HeaderProps) {
	const [open, setOpen] = useState(false);
	const menu = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const close = (e: MouseEvent) => {
			if (!menu.current?.contains(e.target as Node)) setOpen(false);
		};
		addEventListener("mousedown", close);
		return () => removeEventListener("mousedown", close);
	}, [open]);

	const Prev = vertical ? ChevronUp : ChevronLeft;
	const Next = vertical ? ChevronDown : ChevronRight;
	return (
		<>
			<div className="sch-toolbar">
				<div className="sch-toolbar__right">
					<div className="sch-avatar">{avatarInitials}</div>
					<div className="sch-menuwrap" ref={menu}>
						<button
							type="button"
							className="sch-btn"
							aria-haspopup="menu"
							aria-expanded={open}
							onClick={() => setOpen((o) => !o)}
						>
							{viewLabel}
							<ChevronDown size={14} strokeWidth={1.75} className="sch-icon" />
						</button>
						{open && (
							<div className="sch-menu" role="menu">
								{VIEW_ITEMS.map((item) => (
									<button
										key={item.label}
										type="button"
										role="menuitem"
										className="sch-menu__item"
										onClick={() => {
											setOpen(false);
											onView(item.kind, item.count);
										}}
									>
										{item.label}
										<kbd className="sch-kbd">{item.key}</kbd>
									</button>
								))}
							</div>
						)}
					</div>
					<button
						type="button"
						className="sch-btn sch-btn--today"
						onClick={onToday}
					>
						Today
					</button>
					<button
						type="button"
						className="sch-iconbtn"
						aria-label="Previous"
						onClick={() => onStep(-1)}
					>
						<Prev size={18} strokeWidth={1.5} className="sch-icon" />
					</button>
					<button
						type="button"
						className="sch-iconbtn"
						aria-label="Next"
						onClick={() => onStep(1)}
					>
						<Next size={18} strokeWidth={1.5} className="sch-icon" />
					</button>
				</div>
			</div>
			<div className="sch-title">
				<span className="sch-title__month">
					{monthName(month)} {year}
				</span>
				{week !== undefined && (
					<span className="sch-title__week">Week {week}</span>
				)}
			</div>
		</>
	);
}
