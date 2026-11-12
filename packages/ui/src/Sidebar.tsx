import type { Account, Temporal } from "@schedee/core";
import {
	ChevronDown,
	ChevronUp,
	CircleHelp,
	Eye,
	EyeOff,
	Link2,
	PanelLeft,
	Rss,
	Search,
	SquarePen,
	TriangleAlert,
	UserRound,
	X,
} from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import type { Theme } from "./chipColors";

const PROBLEM: Record<NonNullable<Account["problem"]>, string> = {
	signed_out: "Signed out. Sign in again to keep syncing.",
	sync_failed: "Couldn't sync. Schedee will keep trying.",
};

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function MiniMonth({
	today,
	focus,
	band,
	onPick,
}: {
	today: Temporal.PlainDate;
	/** The date the main view is on; the mini-month follows it to its month. */
	focus: Temporal.PlainDate;
	/** First day of the week to highlight, if any. */
	band?: Temporal.PlainDate;
	onPick?: (d: Temporal.PlainDate) => void;
}) {
	const [shown, setShown] = useState(() => focus.with({ day: 1 }));
	useEffect(() => setShown(focus.with({ day: 1 })), [focus]);
	const start = shown.subtract({ days: shown.dayOfWeek - 1 });
	const weeks = Array.from({ length: 6 }, (_, w) => start.add({ weeks: w }));
	return (
		<div className="sch-mini">
			<div className="sch-mini__nav">
				<button
					type="button"
					className="sch-iconbtn"
					style={{ left: 170 }}
					aria-label="Previous month"
					onClick={() => setShown((m) => m.subtract({ months: 1 }))}
				>
					<ChevronUp className="sch-icon" size={16} strokeWidth={1.75} />
				</button>
				<button
					type="button"
					className="sch-iconbtn"
					style={{ left: 198 }}
					aria-label="Next month"
					onClick={() => setShown((m) => m.add({ months: 1 }))}
				>
					<ChevronDown className="sch-icon" size={16} strokeWidth={1.75} />
				</button>
			</div>
			<div className="sch-mini__row">
				<div className="sch-mini__wd" />
				{WEEKDAYS.map((d) => (
					<div key={d} className="sch-mini__wd">
						{d}
					</div>
				))}
			</div>
			{weeks.map((monday) => (
				<div key={monday.toString()} className="sch-mini__row">
					{band?.equals(monday) && <div className="sch-mini__band" />}
					<div className="sch-mini__wn">{monday.weekOfYear}</div>
					{Array.from({ length: 7 }, (_, i) => {
						const d = monday.add({ days: i });
						return (
							<button
								type="button"
								key={d.toString()}
								className={`sch-mini__day${d.month !== shown.month ? " sch-mini__day--out" : ""}`}
								onClick={() => onPick?.(d)}
								aria-label={d.toString()}
							>
								{d.equals(today) && <div className="sch-mini__today" />}
								<span>{d.day}</span>
							</button>
						);
					})}
				</div>
			))}
		</div>
	);
}

function Swatch({
	color,
	isDefault,
	subscribed,
}: {
	color: string;
	isDefault?: boolean;
	subscribed?: boolean;
}) {
	return (
		<span
			className={`sch-calrow__swatch${isDefault ? " sch-calrow__swatch--default" : ""}`}
			style={{ "--swatch": color } as CSSProperties}
		>
			<span>{subscribed && <Rss size={9} strokeWidth={3} color="#fff" />}</span>
		</span>
	);
}

export function Sidebar({
	accounts,
	today,
	theme,
	focus = today,
	band,
	onPickDate,
	onReconnect,
	onDismissDropped,
}: {
	accounts: Account[];
	today: Temporal.PlainDate;
	theme: Theme;
	focus?: Temporal.PlainDate;
	band?: Temporal.PlainDate;
	onPickDate?: (d: Temporal.PlainDate) => void;
	/** Sign an account in again after its sign-in expired. */
	onReconnect?: ((accountId: string) => void) | undefined;
	/** Clear an account's "changes weren't saved" notice. */
	onDismissDropped?: ((accountId: string) => void) | undefined;
}) {
	return (
		<aside className="sch-sidebar">
			<div className="sch-sidebar__top">
				<button
					type="button"
					className="sch-iconbtn"
					style={{ left: 80 }}
					aria-label="Toggle sidebar"
				>
					<PanelLeft className="sch-icon" size={18} strokeWidth={1.5} />
				</button>
				<button
					type="button"
					className="sch-iconbtn"
					style={{ left: 172 }}
					aria-label="Search"
				>
					<Search className="sch-icon" size={18} strokeWidth={1.5} />
				</button>
				<button
					type="button"
					className="sch-iconbtn"
					style={{ left: 202 }}
					aria-label="New event"
				>
					<SquarePen className="sch-icon" size={18} strokeWidth={1.5} />
				</button>
			</div>
			<MiniMonth
				today={today}
				focus={focus}
				{...(band ? { band } : {})}
				{...(onPickDate ? { onPick: onPickDate } : {})}
			/>
			<div className="sch-navrow" style={{ top: 287 }}>
				<Link2 className="sch-icon" size={18} strokeWidth={1.5} />
				<span>Scheduling</span>
				<button type="button" aria-label="Show scheduling links">
					<Eye className="sch-icon" size={16} strokeWidth={1.5} />
				</button>
			</div>
			<div
				className="sch-input"
				style={{
					left: 8,
					top: 327,
					width: 224,
					background: "var(--surface-input)",
				}}
			>
				<UserRound className="sch-icon" size={18} strokeWidth={1.5} />
				<span>Meet with…</span>
			</div>
			<div className="sch-callist">
				{accounts.map((a) => (
					<div key={a.id} className="sch-calgroup">
						<div
							className={`sch-calgroup__label${a.problem ? " sch-calgroup__label--problem" : ""}`}
						>
							{a.label}
							{a.problem && (
								<TriangleAlert
									className="sch-calgroup__alert"
									size={14}
									strokeWidth={2}
									role="img"
									aria-label={PROBLEM[a.problem]}
								>
									<title>{PROBLEM[a.problem]}</title>
								</TriangleAlert>
							)}
						</div>
						{a.problem === "signed_out" && onReconnect && (
							<button
								type="button"
								className="sch-calrow sch-calrow--action"
								onClick={() => onReconnect(a.id)}
							>
								<span className="sch-calrow__label">Sign in again</span>
							</button>
						)}
						{!!a.dropped && (
							<div className="sch-calrow sch-calrow--notice" role="status">
								<span className="sch-calrow__label">
									{a.dropped === 1
										? "1 change wasn't saved"
										: `${a.dropped} changes weren't saved`}
								</span>
								{onDismissDropped && (
									<button
										type="button"
										aria-label="Dismiss"
										onClick={() => onDismissDropped(a.id)}
									>
										<X className="sch-icon" size={14} strokeWidth={1.5} />
									</button>
								)}
							</div>
						)}
						{a.calendars.map((c) => (
							<div
								key={c.id}
								className={`sch-calrow${c.hidden ? " sch-calrow--hidden" : ""}`}
							>
								<Swatch
									color={theme === "dark" ? (c.colorDark ?? c.color) : c.color}
									{...(c.isDefault ? { isDefault: true } : {})}
									{...(c.subscribed ? { subscribed: true } : {})}
								/>
								<span className="sch-calrow__label">
									{c.name}
									{c.isDefault && (
										<span className="sch-calrow__suffix">Default</span>
									)}
								</span>
								{c.hidden && (
									<button type="button" aria-label={`Show ${c.name}`}>
										<EyeOff className="sch-icon" size={16} strokeWidth={1.5} />
									</button>
								)}
							</div>
						))}
					</div>
				))}
			</div>
			<div className="sch-sidebar__footer">
				<button
					type="button"
					className="sch-iconbtn"
					style={{ left: 10, top: 8.5 }}
					aria-label="Help"
				>
					<CircleHelp className="sch-icon" size={20} strokeWidth={1.5} />
				</button>
				<span className="sch-dot" style={{ left: 30, top: 10.5 }} />
			</div>
		</aside>
	);
}
