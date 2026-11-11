import { ArrowDownUp, Search, Undo2 } from "lucide-react";
import {
	type KeyboardEvent,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

export interface CommandItem {
	id: string;
	label: string;
	/** Keycaps for the shortcut, e.g. ["⌥", "T"]. */
	keys?: string[];
	/** A second shortcut, shown after "or". */
	orKeys?: string[];
	/** Runs the command and closes the menu. */
	run?: () => void;
	/** Opens a sub-list instead of running. */
	items?: CommandItem[];
	/** Asks for text; `submit` returns false to keep asking. */
	prompt?: { placeholder: string; submit: (text: string) => boolean };
}

export interface CommandGroup {
	label: string;
	items: CommandItem[];
}

type Page =
	| { kind: "list"; groups: CommandGroup[]; placeholder: string }
	| { kind: "prompt"; item: CommandItem };

export interface CommandMenuProps {
	groups: CommandGroup[];
	onClose: () => void;
	/** Open straight into this command's sub-list or prompt. */
	startWith?: string | undefined;
	/** Offer "Search events for …" for whatever is typed. */
	onSearch?: ((query: string) => void) | undefined;
}

const ROOT_PLACEHOLDER = "Type a command...";

/** Every word of the query appears in the label, in any order. */
const matches = (label: string, query: string) => {
	const l = label.toLowerCase();
	return query
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((w) => l.includes(w));
};

const pageFor = (item: CommandItem): Page | null =>
	item.prompt
		? { kind: "prompt", item }
		: item.items
			? {
					kind: "list",
					groups: [{ label: item.label.replace(/…$/, ""), items: item.items }],
					placeholder: `${item.label.replace(/…$/, "")}...`,
				}
			: null;

function Keys({ keys }: { keys: string[] }) {
	return keys.map((k) => (
		<kbd key={k} className="sch-kbd">
			{k}
		</kbd>
	));
}

/** The ⌘K command menu: a filterable list of commands with sub-lists and text prompts. */
export function CommandMenu({
	groups,
	onClose,
	startWith,
	onSearch,
}: CommandMenuProps) {
	const root: Page = {
		kind: "list",
		groups,
		placeholder: ROOT_PLACEHOLDER,
	};
	const [stack, setStack] = useState<Page[]>(() => {
		const item = groups.flatMap((g) => g.items).find((i) => i.id === startWith);
		const sub = item && pageFor(item);
		return sub ? [root, sub] : [root];
	});
	const page = stack.at(-1) ?? root;
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const [invalid, setInvalid] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const listId = useId();

	// The root page always reflects the latest commands (labels change with state).
	const current: Page = stack.length === 1 ? root : page;
	const visible =
		current.kind === "list"
			? current.groups
					.map((g) => ({
						...g,
						items: g.items.filter((i) => matches(i.label, query)),
					}))
					.filter((g) => g.items.length > 0)
			: [];
	if (onSearch && stack.length === 1 && query.trim())
		visible.push({
			label: "Search",
			items: [
				{
					id: "search-for",
					label: `Search events for “${query.trim()}”`,
					run: () => onSearch(query.trim()),
				},
			],
		});
	const flat = visible.flatMap((g) => g.items);
	const activeItem = flat[Math.min(active, flat.length - 1)];

	useEffect(() => input.current?.focus(), []);
	useLayoutEffect(() => {
		list.current
			?.querySelector('[aria-selected="true"]')
			?.scrollIntoView({ block: "nearest" });
	});

	// Where each parent page was left, so going back returns to the same filter and row.
	const saved = useRef<{ query: string; active: number }[]>([]);
	const open = (p: Page) => {
		saved.current.push({ query, active });
		setStack((s) => [...s, p]);
		setQuery("");
		setActive(0);
		setInvalid(false);
	};
	const back = () => {
		if (stack.length === 1) return onClose();
		const prev = saved.current.pop();
		setStack((s) => s.slice(0, -1));
		setQuery(prev?.query ?? "");
		setActive(prev?.active ?? 0);
		setInvalid(false);
	};
	const choose = (item: CommandItem | undefined) => {
		if (!item) return;
		const sub = pageFor(item);
		if (sub) return open(sub);
		onClose();
		item.run?.();
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		e.stopPropagation();
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
			e.preventDefault();
			onClose();
		} else if (e.key === "Escape") {
			e.preventDefault();
			back();
		} else if (e.key === "Backspace" && query === "" && stack.length > 1) {
			e.preventDefault();
			back();
		} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if (!flat.length) return;
			const d = e.key === "ArrowDown" ? 1 : -1;
			setActive(
				(a) => (Math.min(a, flat.length - 1) + d + flat.length) % flat.length,
			);
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (current.kind === "prompt") {
				if (current.item.prompt?.submit(query)) onClose();
				else setInvalid(true);
			} else choose(activeItem);
		}
	};

	return (
		<div
			className="sch-cmdk__scrim"
			role="presentation"
			onPointerDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="sch-cmdk" role="dialog" aria-label="Command menu">
				<div className="sch-cmdk__input">
					<Search size={20} strokeWidth={1.6} className="sch-icon" />
					<input
						ref={input}
						value={query}
						role="combobox"
						aria-expanded={current.kind === "list"}
						aria-controls={listId}
						aria-activedescendant={
							activeItem ? `${listId}-${activeItem.id}` : undefined
						}
						aria-invalid={invalid || undefined}
						aria-label="Command"
						placeholder={
							current.kind === "prompt"
								? current.item.prompt?.placeholder
								: current.placeholder
						}
						onChange={(e) => {
							setQuery(e.target.value);
							setActive(0);
							setInvalid(false);
						}}
						onKeyDown={onKeyDown}
					/>
				</div>
				{current.kind === "list" && (
					<div className="sch-cmdk__list" id={listId} role="listbox" ref={list}>
						{visible.map((g) => (
							<div key={g.label} className="sch-cmdk__group">
								<div className="sch-cmdk__label">{g.label}</div>
								{g.items.map((item) => (
									<div
										key={item.id}
										id={`${listId}-${item.id}`}
										role="option"
										tabIndex={-1}
										aria-selected={item === activeItem}
										className="sch-cmdk__item"
										onPointerMove={() => setActive(flat.indexOf(item))}
										onClick={() => choose(item)}
										onKeyDown={() => {}}
									>
										<span className="sch-cmdk__text">{item.label}</span>
										{item.keys && (
											<span className="sch-keys">
												<Keys keys={item.keys} />
												{item.orKeys && (
													<>
														<span className="sch-cmdk__or">or</span>
														<Keys keys={item.orKeys} />
													</>
												)}
											</span>
										)}
									</div>
								))}
							</div>
						))}
						{flat.length === 0 && (
							<div className="sch-cmdk__empty">No matching commands</div>
						)}
					</div>
				)}
				<div className="sch-cmdk__footer">
					<span>
						<ArrowDownUp size={12} strokeWidth={1.75} className="sch-icon" />
						Navigate
					</span>
					<span>
						<Undo2
							size={12}
							strokeWidth={1.75}
							className="sch-icon sch-cmdk__enter"
						/>
						Select
					</span>
					<span>
						<kbd className="sch-cmdk__esc">esc</kbd>
						{stack.length > 1 ? "Back" : "Close"}
					</span>
				</div>
			</div>
		</div>
	);
}
