import {
	type Attendee,
	type Calendar,
	describeRule,
	type EditScope,
	type EventInstance,
	type EventPatch,
	formatDuration,
	parseDate,
	parseTime,
	type Rsvp,
	rulePresets,
	Temporal,
} from "@schedee/core";
import {
	ArrowRight,
	Bell,
	ChevronDown,
	Clock,
	Ellipsis,
	Globe,
	MapPin,
	Repeat,
	UsersRound,
	Video,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { formatTime } from "./format";

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
const fmtDate = (d: Temporal.PlainDate) =>
	`${WEEKDAY[d.dayOfWeek - 1]} ${MONTH[d.month - 1]} ${d.day}`;
const REMINDERS = [5, 10, 15, 30, 60, 1440];
const reminderLabel = (m: number) =>
	m >= 1440
		? `${m / 1440} day before`
		: m >= 60
			? `${m / 60} h before`
			: `${m} min before`;
const CONFERENCE: Record<string, string> = {
	zoom: "Zoom",
	meet: "Google Meet",
	teams: "Microsoft Teams",
	other: "Video call",
};

export interface EventPanelProps {
	instance: EventInstance;
	calendar: Calendar | undefined;
	/** Calendars the event can be moved to. */
	writable: Calendar[];
	readOnly: boolean;
	theme: "light" | "dark";
	onChange: (patch: EventPatch, scope: EditScope) => void;
	onDelete: (scope: EditScope) => void;
	/** Put the cursor in the title, for an event that was just created. */
	focusTitle?: boolean;
}

/** Text that commits on Enter or blur, and reverts on Escape. */
function Field({
	value,
	placeholder,
	onCommit,
	className = "",
	multiline = false,
	readOnly = false,
	label,
	focus = false,
}: {
	value: string;
	placeholder?: string;
	/** Return `false` to reject the input and revert. */
	onCommit: (v: string) => unknown;
	className?: string;
	multiline?: boolean;
	readOnly?: boolean;
	label: string;
	focus?: boolean;
}) {
	const [draft, setDraft] = useState(value);
	const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
	useEffect(() => {
		if (focus) ref.current?.focus();
	}, [focus]);
	useEffect(() => setDraft(value), [value]);
	const commit = () => {
		if (draft === value) return;
		if (onCommit(draft) === false) setDraft(value);
	};
	const props = {
		ref,
		className: `sch-field ${className}`,
		value: draft,
		placeholder,
		readOnly,
		"aria-label": label,
		onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
		onBlur: commit,
		onKeyDown: (
			e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
		) => {
			e.stopPropagation();
			if (e.key === "Escape") {
				setDraft(value);
				(e.target as HTMLElement).blur();
			}
			if (e.key === "Enter" && !(multiline && e.shiftKey)) {
				e.preventDefault();
				(e.target as HTMLElement).blur();
			}
		},
	};
	return multiline ? <textarea rows={1} {...props} /> : <input {...props} />;
}

/** A small anchored menu. */
function Menu<T>({
	trigger,
	items,
	onPick,
	disabled,
	value = true,
}: {
	/** Shows a current value (primary text) rather than an action link. */
	value?: boolean;
	trigger: ReactNode;
	items: { label: string; value: T; active?: boolean }[];
	onPick: (v: T) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (!open) return;
		const close = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false);
		};
		addEventListener("mousedown", close);
		return () => removeEventListener("mousedown", close);
	}, [open]);
	return (
		<span className="sch-menuwrap" ref={ref}>
			<button
				type="button"
				className={`sch-ep__link${value ? " sch-ep__link--value" : ""}`}
				disabled={disabled}
				onClick={() => setOpen((o) => !o)}
			>
				{trigger}
			</button>
			{open && (
				<div className="sch-menu sch-menu--left" role="menu">
					{items.map((it) => (
						<button
							key={it.label}
							type="button"
							role="menuitemradio"
							aria-checked={!!it.active}
							className="sch-menu__item"
							onClick={() => {
								setOpen(false);
								onPick(it.value);
							}}
						>
							{it.label}
						</button>
					))}
				</div>
			)}
		</span>
	);
}

const Row = ({
	icon,
	children,
	className = "",
}: {
	icon?: ReactNode;
	children: ReactNode;
	className?: string;
}) => (
	<div className={`sch-ep__row ${className}`}>
		{icon && <span className="sch-ep__icon">{icon}</span>}
		{children}
	</div>
);

const initials = (a: Attendee) =>
	(a.name ?? a.email).trim().charAt(0).toUpperCase();

export function EventPanel({
	instance,
	calendar,
	writable,
	readOnly,
	theme,
	onChange,
	onDelete,
	focusTitle = false,
}: EventPanelProps) {
	const recurring = !!instance.occurrence;
	const [scope, setScope] = useState<EditScope>("this");
	const [moreOpen, setMoreOpen] = useState(false);
	const change = (patch: EventPatch) => onChange(patch, scope);

	const allDay = instance.allDay;
	const startDt = allDay
		? Temporal.PlainDate.from(instance.start).toPlainDateTime()
		: Temporal.PlainDateTime.from(instance.start);
	const endDt = allDay
		? Temporal.PlainDate.from(instance.end).toPlainDateTime()
		: Temporal.PlainDateTime.from(instance.end);
	const minutes = startDt.until(endDt, { largestUnit: "minutes" }).minutes;
	const date = startDt.toPlainDate();
	const mins = (dt: Temporal.PlainDateTime) => dt.hour * 60 + dt.minute;
	const atMinutes = (d: Temporal.PlainDate, m: number) =>
		d.toPlainDateTime({ hour: Math.floor(m / 60), minute: m % 60 }).toString();

	const setStart = (v: string) => {
		const m = parseTime(v);
		if (m === null) return false;
		const s = Temporal.PlainDateTime.from(atMinutes(date, m));
		change({ start: s.toString(), end: s.add({ minutes }).toString() });
	};
	const setEnd = (v: string) => {
		const m = parseTime(v);
		if (m === null) return false;
		let e = Temporal.PlainDateTime.from(atMinutes(date, m));
		if (Temporal.PlainDateTime.compare(e, startDt) <= 0) e = e.add({ days: 1 });
		change({ end: e.toString() });
	};
	const setDate = (v: string) => {
		const d = parseDate(v, date);
		if (!d) return false;
		const shift = date.until(d);
		change(
			allDay
				? {
						start: d.toString(),
						end: Temporal.PlainDate.from(instance.end).add(shift).toString(),
					}
				: {
						start: startDt.add(shift).toString(),
						end: endDt.add(shift).toString(),
					},
		);
	};
	const toggleAllDay = () =>
		change(
			allDay
				? {
						allDay: false,
						start: atMinutes(date, 9 * 60),
						end: atMinutes(date, 10 * 60),
					}
				: {
						allDay: true,
						start: date.toString(),
						end: date.add({ days: 1 }).toString(),
					},
		);

	const attendees = instance.attendees ?? [];
	const self = attendees.find((a) => a.self);
	const counts = (
		["accepted", "tentative", "declined", "needsAction"] as Rsvp[]
	).map((r) => attendees.filter((a) => (a.rsvp ?? "needsAction") === r).length);
	const rsvp = (r: Rsvp) =>
		onChange(
			{
				rsvp: r,
				attendees: attendees.map((a) => (a.self ? { ...a, rsvp: r } : a)),
			},
			scope,
		);
	const rule = instance.recurrence?.rrule;
	const swatch =
		theme === "dark"
			? (calendar?.colorDark ?? calendar?.color)
			: calendar?.color;

	return (
		<div className="sch-ep" data-event-panel={instance.id}>
			<div className="sch-ep__head">
				<span>Event</span>
				{!readOnly && (
					<span className="sch-menuwrap">
						<button
							type="button"
							className="sch-iconbtn sch-ep__more"
							aria-label="More actions"
							onClick={() => setMoreOpen((o) => !o)}
						>
							<Ellipsis size={16} strokeWidth={1.5} className="sch-icon" />
						</button>
						{moreOpen && (
							<div className="sch-menu" role="menu">
								<button
									type="button"
									role="menuitem"
									className="sch-menu__item sch-menu__item--danger"
									onClick={() => {
										setMoreOpen(false);
										onDelete(scope);
									}}
								>
									{recurring && scope === "all"
										? "Delete all events"
										: "Delete event"}
								</button>
							</div>
						)}
					</span>
				)}
			</div>
			{recurring && !readOnly && (
				<fieldset className="sch-ep__scope" aria-label="Apply changes to">
					{(["this", "all"] as EditScope[]).map((s) => (
						<button
							key={s}
							type="button"
							aria-pressed={scope === s}
							onClick={() => setScope(s)}
						>
							{s === "this" ? "This event" : "All events"}
						</button>
					))}
				</fieldset>
			)}
			<Field
				label="Title"
				className="sch-ep__title"
				value={instance.title}
				placeholder="New event"
				multiline
				focus={focusTitle}
				readOnly={readOnly}
				onCommit={(v) => (v.trim() ? change({ title: v.trim() }) : false)}
			/>
			<div className="sch-ep__divider" />

			<section className="sch-ep__section">
				{allDay ? (
					<Row icon={<Clock size={18} strokeWidth={1.5} />}>
						<Field
							label="Date"
							className="sch-ep__date sch-ep__date--allday"
							value={fmtDate(date)}
							readOnly={readOnly}
							onCommit={setDate}
						/>
						{minutes > 1440 && (
							<span className="sch-ep__muted">{minutes / 1440} days</span>
						)}
					</Row>
				) : (
					<>
						<Row icon={<Clock size={18} strokeWidth={1.5} />}>
							<Field
								label="Start"
								className="sch-ep__start"
								value={formatTime(mins(startDt))}
								readOnly={readOnly}
								onCommit={setStart}
							/>
							<ArrowRight
								size={16}
								strokeWidth={1.5}
								className="sch-ep__arrow"
							/>
							<span className="sch-ep__endwrap">
								<Field
									label="End"
									className="sch-ep__end"
									value={formatTime(mins(endDt))}
									readOnly={readOnly}
									onCommit={setEnd}
								/>
								<span className="sch-ep__muted sch-ep__dur">
									{formatDuration(minutes)}
								</span>
							</span>
						</Row>
						<Row>
							<Field
								label="Date"
								className="sch-ep__date"
								value={fmtDate(date)}
								readOnly={readOnly}
								onCommit={setDate}
							/>
						</Row>
					</>
				)}
				{!readOnly && (
					<Row className="sch-ep__toggles">
						<button
							type="button"
							className="sch-ep__link"
							aria-pressed={allDay}
							onClick={toggleAllDay}
						>
							All-day
						</button>
						<span className="sch-ep__link sch-ep__link--static">Time zone</span>
						{!rule && (
							<Menu
								trigger="Repeat"
								value={false}
								items={rulePresets(date).map((p) => ({
									label: p.label,
									value: p.rrule,
								}))}
								onPick={(r) => r && change({ recurrence: { rrule: r } })}
							/>
						)}
					</Row>
				)}
				{instance.timeZone &&
					instance.timeZone !== Temporal.Now.timeZoneId() && (
						<Row icon={<Globe size={18} strokeWidth={1.5} />}>
							<span>
								{instance.timeZone.split("/").at(-1)?.replaceAll("_", " ")}
							</span>
						</Row>
					)}
				{rule && (
					<Row icon={<Repeat size={18} strokeWidth={1.5} />}>
						<Menu
							disabled={readOnly}
							trigger={
								<>
									<span>{describeRule(rule)[0]}</span>
									<span className="sch-ep__muted">{describeRule(rule)[1]}</span>
								</>
							}
							items={rulePresets(date).map((p) => ({
								label: p.label,
								value: p.rrule,
								active: p.rrule === rule,
							}))}
							onPick={(r) =>
								onChange(
									r ? { recurrence: { rrule: r } } : { recurrence: undefined },
									"all",
								)
							}
						/>
					</Row>
				)}
			</section>
			<div className="sch-ep__divider" />

			<section className="sch-ep__section">
				{attendees.length > 0 ? (
					<>
						<Row
							icon={<UsersRound size={18} strokeWidth={1.5} />}
							className="sch-ep__people"
						>
							<div>
								<div>{attendees.length} participants</div>
								<div className="sch-ep__muted sch-ep__small">
									{[
										counts[0] && `${counts[0]} yes`,
										counts[1] && `${counts[1]} maybe`,
										counts[2] && `${counts[2]} no`,
										counts[3] && `${counts[3]} awaiting`,
									]
										.filter(Boolean)
										.join(", ")}
								</div>
							</div>
						</Row>
						{attendees.slice(0, 6).map((a) => (
							<Row key={a.email} className="sch-ep__person">
								<span
									className={`sch-ep__avatar sch-ep__avatar--${a.rsvp ?? "needsAction"}`}
								>
									{initials(a)}
								</span>
								<div>
									<div className="sch-ep__name">{a.name ?? a.email}</div>
									{a.organizer && (
										<div className="sch-ep__muted sch-ep__faint">Organizer</div>
									)}
								</div>
							</Row>
						))}
						{self && !self.organizer && (
							<fieldset className="sch-ep__rsvp" aria-label="Going?">
								{(
									[
										["accepted", "Yes"],
										["declined", "No"],
										["tentative", "Maybe"],
									] as [Rsvp, string][]
								).map(([r, label]) => (
									<button
										key={r}
										type="button"
										aria-pressed={self.rsvp === r}
										onClick={() => rsvp(r)}
									>
										{label}
									</button>
								))}
							</fieldset>
						)}
					</>
				) : (
					instance.createdBy && (
						<Row icon={<UsersRound size={18} strokeWidth={1.5} />}>
							<span>Created by</span>
							<span className="sch-ep__faint">{instance.createdBy}</span>
						</Row>
					)
				)}
				{
					<Row className="sch-ep__addrow">
						<Field
							label="Add participant"
							className="sch-ep__add"
							value=""
							placeholder="Add participant or room"
							readOnly={readOnly}
							onCommit={(v) => {
								const email = v.trim();
								if (!/^\S+@\S+\.\S+$/.test(email)) return false;
								change({
									attendees: [...attendees, { email, rsvp: "needsAction" }],
								});
							}}
						/>
					</Row>
				}
			</section>
			<div className="sch-ep__divider" />

			{(!readOnly || instance.conference || instance.location) && (
				<>
					<section className="sch-ep__section">
						<Row icon={<Video size={18} strokeWidth={1.5} />}>
							{instance.conference ? (
								<a
									className="sch-ep__conf"
									href={instance.conference.url}
									target="_blank"
									rel="noreferrer"
								>
									{CONFERENCE[instance.conference.kind]}
									{instance.conference.label && (
										<span className="sch-ep__faint">
											{instance.conference.label}
										</span>
									)}
								</a>
							) : (
								<Field
									label="Conferencing"
									className="sch-ep__inline"
									value=""
									placeholder="Conferencing"
									readOnly={readOnly}
									onCommit={(v) => {
										const url = v.trim();
										if (!/^https?:\/\//.test(url)) return false;
										const kind = /zoom\.us/.test(url)
											? "zoom"
											: /meet\.google/.test(url)
												? "meet"
												: /teams\./.test(url)
													? "teams"
													: "other";
										change({ conference: { kind, url } });
									}}
								/>
							)}
						</Row>
						<Row icon={<MapPin size={18} strokeWidth={1.5} />}>
							<Field
								label="Location"
								className="sch-ep__inline"
								value={instance.location ?? ""}
								placeholder="Location"
								readOnly={readOnly}
								onCommit={(v) => change({ location: v.trim() })}
							/>
						</Row>
					</section>
					<div className="sch-ep__divider" />
				</>
			)}

			{(!readOnly || instance.description) && (
				<>
					<section className="sch-ep__section">
						<Field
							label="Description"
							className="sch-ep__desc"
							value={instance.description ?? ""}
							placeholder="Description"
							multiline
							readOnly={readOnly}
							onCommit={(v) => change({ description: v })}
						/>
					</section>
					<div className="sch-ep__divider" />
				</>
			)}

			<section className="sch-ep__section">
				<Row
					icon={
						<span className="sch-ep__swatch" style={{ background: swatch }} />
					}
				>
					<Menu
						disabled={readOnly || writable.length < 2}
						trigger={
							<>
								{calendar?.name ?? "Calendar"}
								{!readOnly && writable.length > 1 && (
									<ChevronDown
										size={14}
										strokeWidth={1.5}
										className="sch-icon"
									/>
								)}
							</>
						}
						items={writable.map((c) => ({
							label: c.name,
							value: c.id,
							active: c.id === instance.calendarId,
						}))}
						onPick={(id) => change({ calendarId: id })}
					/>
				</Row>
				<Row className="sch-ep__pair">
					<button
						type="button"
						className="sch-ep__link sch-ep__link--plain"
						disabled={readOnly}
						onClick={() => change({ busy: instance.busy === false })}
					>
						{instance.busy === false ? "Free" : "Busy"}
					</button>
					<Menu
						disabled={readOnly}
						trigger={
							instance.visibility === "public"
								? "Public"
								: instance.visibility === "private"
									? "Private"
									: "Default visibility"
						}
						items={(["default", "public", "private"] as const).map((v) => ({
							label:
								v === "default"
									? "Default visibility"
									: v[0]?.toUpperCase() + v.slice(1),
							value: v,
							active: (instance.visibility ?? "default") === v,
						}))}
						onPick={(v) => change({ visibility: v })}
					/>
				</Row>
				{!readOnly && (
					<Row icon={<Bell size={18} strokeWidth={1.5} />}>
						{(instance.reminders ?? []).map((m) => (
							<button
								key={m}
								type="button"
								className="sch-ep__chip"
								title="Remove reminder"
								onClick={() =>
									change({
										reminders: (instance.reminders ?? []).filter(
											(x) => x !== m,
										),
									})
								}
							>
								{reminderLabel(m)}
							</button>
						))}
						<Menu
							value={false}
							trigger={
								<span className="sch-ep__faint">
									{instance.reminders?.length ? "Add" : "Reminders"}
								</span>
							}
							items={REMINDERS.filter(
								(m) => !instance.reminders?.includes(m),
							).map((m) => ({ label: reminderLabel(m), value: m }))}
							onPick={(m) =>
								change({
									reminders: [...(instance.reminders ?? []), m].sort(
										(a, b) => a - b,
									),
								})
							}
						/>
					</Row>
				)}
			</section>
		</div>
	);
}
