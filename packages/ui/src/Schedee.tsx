import { type Calendar, type CalendarSnapshot, Temporal } from "@schedee/core";
import { useEffect } from "react";
import { ContextPanel } from "./ContextPanel";
import type { Theme } from "./chipColors";
import { Sidebar } from "./Sidebar";
import { WeekView } from "./WeekView";

/** The whole app frame for a static snapshot: sidebar, week view, context panel. */
export function Schedee({
	snapshot,
	theme,
	scrollTop,
}: {
	snapshot: CalendarSnapshot;
	theme: Theme;
	/** Initial grid scroll in px; defaults to bringing "now" into view. */
	scrollTop?: number;
}) {
	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);
	const now = Temporal.PlainDateTime.from(snapshot.now);
	const calendars = new Map<string, Calendar>(
		snapshot.accounts.flatMap((a) => a.calendars.map((c) => [c.id, c])),
	);
	return (
		<div className="sch-app" data-schedee-ready>
			<Sidebar
				accounts={snapshot.accounts}
				today={now.toPlainDate()}
				theme={theme}
			/>
			<WeekView
				events={snapshot.events}
				calendars={calendars}
				now={now}
				timeZoneLabel={snapshot.timeZoneLabel}
				theme={theme}
				{...(scrollTop === undefined ? {} : { scrollTop })}
			/>
			<ContextPanel />
		</div>
	);
}
