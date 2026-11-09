import { Temporal, weekOf } from "@schedee/core";

export function App() {
	const week = weekOf(Temporal.Now.plainDateISO());
	return (
		<main className="grid min-h-dvh place-items-center bg-neutral-950 text-neutral-100">
			<div className="text-center">
				<h1 className="text-2xl font-semibold">Schedee</h1>
				<p className="mt-1 text-sm text-neutral-400" data-testid="week-range">
					{week.start.toString()} to {week.end.toString()}
				</p>
			</div>
		</main>
	);
}
