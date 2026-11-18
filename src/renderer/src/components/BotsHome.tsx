import { useEffect, useState, type DragEvent, type FormEvent, type MouseEvent, type ReactNode } from "react";
import type { BotWork } from "../state/useWork";
import { timeLabel } from "../state/chats";
import { botColor, homeLayout, keptColor, type Bot } from "../state/bots";
import {
  addToDraft,
  defaultRoomName,
  ROOM_MAX_MEMBERS,
  ROOM_MIN_MEMBERS,
  type Room,
} from "../state/groups";
import { starterFace } from "../state/starterFaces";
import { useAvatar } from "../state/useBots";
import { Icon } from "./icons";
import { StarterFaceArt } from "./StarterFaceArt";
import { t } from "@shared/i18n";

const BOT_DRAG = "application/x-conduit-bot";

/** A bot's picture, else its starter face (on the color Hermes keeps for it, when it has one). */
export function BotAvatar({ bot, size }: { bot: Bot; size: number }) {
  const url = useAvatar(bot.name, bot.hasAvatar);
  const color = botColor(bot);
  return (
    <span
      className="bot-avatar"
      style={{
        width: size,
        height: size,
        boxShadow: `0 0 0 2px color-mix(in srgb, ${color} 25%, transparent)`,
      }}
      aria-hidden="true"
    >
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <StarterFaceArt
          face={starterFace(bot.face)}
          background={keptColor(bot.color)}
        />
      )}
    </span>
  );
}

/** A room's icon: its bots' faces overlapping. */
export function RoomFaces({
  room,
  bots,
  size,
}: {
  room: Pick<Room, "members">;
  bots: Bot[];
  size: number;
}) {
  const shown = room.members
    .map((m) => bots.find((b) => b.name === (m.profile ?? m.memberId)))
    .filter((b): b is Bot => !!b)
    .slice(0, 4);
  return (
    <span className="room-faces" style={{ height: size }} aria-hidden="true">
      {shown.map((bot, i) => (
        <span
          key={bot.name}
          style={{ marginLeft: i ? -size * 0.38 : 0, zIndex: shown.length - i }}
        >
          <BotAvatar bot={bot} size={size} />
        </span>
      ))}
    </span>
  );
}

interface Props {
  bots: Bot[] | null;
  error: string | null;
  runningProfiles: ReadonlySet<string>;
  rooms: Room[] | null;
  canStartRooms: boolean;
  onOpen: (bot: Bot) => void;
  onAsk: (bot: Bot, text: string) => void;
  onOpenRoom: (room: Room) => void;
  onCreateRoom: (roomId: string, name: string, bots: Bot[]) => Promise<Room>;
  /** Edit Bot, from a bot's right-click menu. */
  onEdit?: (bot: Bot) => void;
  /** Each bot's workstreams: what needs you and what's working. */
  work?: ReadonlyMap<string, BotWork>;
  /** The pill opens the bot's work. */
  onWork?: (bot: Bot) => void;
}

/** A bot's pill: what needs you first, then what's working, else nothing. */
export function workPill(work: BotWork | undefined): { text: string; needs: boolean } | null {
  if (!work) return null;
  if (work.needsYou > 0) return { text: t("{count} needs you", { count: work.needsYou }), needs: true };
  if (work.working > 0) return { text: t("{count} working", { count: work.working }), needs: false };
  return null;
}

function WorkPill({ bot, work, onWork }: { bot: Bot; work?: BotWork; onWork?: (bot: Bot) => void }) {
  const pill = workPill(work);
  if (!pill) return null;
  return (
    <span
      role="button"
      tabIndex={0}
      className={`work-pill${pill.needs ? " needs" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onWork?.(bot);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onWork?.(bot);
        }
      }}
    >
      {pill.text}
    </span>
  );
}

interface Draft {
  roomId: string;
  members: string[];
  name: string;
  busy: boolean;
  error?: string;
}

/**
 * Bots home: one bot gets the whole page with an Ask field, two sit side by
 * side, and more make a grid of portraits (the phone's layouts). A bot opens
 * its Bot Chat. A bot dropped on another starts a group chat: a bar lists
 * the bots, more join by a drop or a click, and Create makes the room.
 */
export function BotsHome({
  bots,
  error,
  runningProfiles,
  rooms,
  canStartRooms,
  onOpen,
  onAsk,
  onOpenRoom,
  onCreateRoom,
  onEdit,
  work,
  onWork,
}: Props) {
  const [menu, setMenu] = useState<{ bot: Bot; x: number; y: number } | null>(
    null,
  );
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);
  const openMenu = onEdit
    ? (bot: Bot) => (e: MouseEvent) => {
        e.preventDefault();
        setMenu({ bot, x: e.clientX, y: e.clientY });
      }
    : undefined;
  const layout = homeLayout(bots?.length ?? 0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const canDrag = canStartRooms && (bots?.length ?? 0) >= ROOM_MIN_MEMBERS;

  const join = (...names: string[]) => {
    setDraft((current) => {
      if (current?.busy) return current;
      const base = current ?? {
        roomId: crypto.randomUUID(),
        members: [],
        name: "",
        busy: false,
      };
      return {
        ...base,
        members: addToDraft(base.members, ...names),
        error: undefined,
      };
    });
  };
  const leave = (name: string) =>
    setDraft((current) =>
      current && !current.busy
        ? { ...current, members: current.members.filter((m) => m !== name) }
        : current,
    );

  const draftBots = draft
    ? draft.members
        .map((name) => bots?.find((b) => b.name === name))
        .filter((b): b is Bot => !!b)
    : [];
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || draftBots.length < ROOM_MIN_MEMBERS || draft.busy) return;
    const name =
      draft.name.trim() || defaultRoomName(draftBots.map((b) => b.title));
    setDraft({ ...draft, busy: true, error: undefined });
    try {
      const room = await onCreateRoom(draft.roomId, name, draftBots);
      setDraft(null);
      onOpenRoom(room);
    } catch (e) {
      // Kept with the same room id, so a retry never makes a twin.
      setDraft((current) =>
        current
          ? {
              ...current,
              busy: false,
              error: e instanceof Error ? e.message : String(e),
            }
          : current,
      );
    }
  };

  const tileDrag = (bot: Bot) =>
    canDrag
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.setData(BOT_DRAG, bot.name);
            e.dataTransfer.effectAllowed = "copy";
          },
          onDragOver: (e: DragEvent) => {
            if (!e.dataTransfer.types.includes(BOT_DRAG)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (dropTarget !== bot.name) setDropTarget(bot.name);
          },
          onDragLeave: () => setDropTarget((t) => (t === bot.name ? null : t)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setDropTarget(null);
            const dragged = e.dataTransfer.getData(BOT_DRAG);
            if (dragged && dragged !== bot.name) join(bot.name, dragged);
            else if (dragged && draft) join(dragged);
          },
          onDragEnd: () => setDropTarget(null),
        }
      : {};

  const openOrPick = (bot: Bot) => {
    if (!draft) return onOpen(bot);
    if (draft.members.includes(bot.name)) leave(bot.name);
    else join(bot.name);
  };

  return (
    <main className={`bots${draft ? " drafting" : ""}`}>
      <div className="bots-scroll">
        <div className={`bots-inner ${layout}`}>
          <h1>{t('Bots')}</h1>
          {bots === null && !error ? (
            <div className="empty">{t('Loading your bots…')}</div>
          ) : null}
          {error ? (
            <div className="empty">{t('Couldn’t load your bots: {error}', { error })}</div>
          ) : null}
          {bots && layout === "one" && bots[0] ? (
            <OneBot
              bot={bots[0]}
              running={runningProfiles.has(bots[0].name)}
              onOpen={onOpen}
              onAsk={onAsk}
              onMenu={openMenu?.(bots[0])}
              pill={<WorkPill bot={bots[0]} work={work?.get(bots[0].name)} onWork={onWork} />}
            />
          ) : null}
          {bots && layout !== "one" ? (
            <div className={layout === "two" ? "bots-two" : "bots-grid"}>
              {bots.map((bot) => (
                <BotTile
                  key={bot.name}
                  bot={bot}
                  large={layout === "two"}
                  running={runningProfiles.has(bot.name)}
                  picked={draft?.members.includes(bot.name) ?? false}
                  target={dropTarget === bot.name}
                  onClick={() => openOrPick(bot)}
                  onMenu={openMenu?.(bot)}
                  pill={<WorkPill bot={bot} work={work?.get(bot.name)} onWork={onWork} />}
                  drag={tileDrag(bot)}
                />
              ))}
            </div>
          ) : null}
          {rooms && (rooms.length > 0 || canDrag) ? (
            <section className="rooms">
              <h2>{t('Group chats')}</h2>
              {rooms.length === 0 && !draft ? (
                <p className="meta hint">
                  {t('Drag one bot onto another to start a group chat.')}
                </p>
              ) : null}
              <div className="rooms-grid">
                {rooms.map((room) => (
                  <button
                    key={room.roomId}
                    className="room-tile"
                    onClick={() => onOpenRoom(room)}
                  >
                    <RoomFaces room={room} bots={bots ?? []} size={44} />
                    <span className="bot-name">{room.name}</span>
                    {room.updatedAt ? (
                      <span className="meta bot-time">
                        {timeLabel(room.updatedAt)}
                      </span>
                    ) : null}
                  </button>
                ))}
                {draft ? (
                  <div
                    className="room-tile starting"
                    aria-label={t('Group chat being started')}
                  >
                    <RoomFaces
                      room={{
                        members: draft.members.map((m) => ({
                          memberId: m,
                          profile: m,
                        })),
                      }}
                      bots={bots ?? []}
                      size={44}
                    />
                    <span className="bot-name">
                      {draft.name.trim() || t('New room')}
                    </span>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>
      {draft ? (
        <form
          className="room-draft"
          onSubmit={create}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(BOT_DRAG)) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const dragged = e.dataTransfer.getData(BOT_DRAG);
            if (dragged) join(dragged);
          }}
        >
          <div className="room-draft-faces">
            {draftBots.map((bot) => (
              <button
                key={bot.name}
                type="button"
                className="draft-face"
                title={t('Take {name} out', { name: bot.title })}
                onClick={() => leave(bot.name)}
                disabled={draft.busy}
              >
                <BotAvatar bot={bot} size={36} />
                <span className="draft-x" aria-hidden="true">
                  <Icon name="close" />
                </span>
              </button>
            ))}
            <span className="meta">
              {draftBots.length < ROOM_MIN_MEMBERS
                ? t('Drop or click one more bot.')
                : draftBots.length >= ROOM_MAX_MEMBERS
                  ? t('Six is the most a room holds.')
                  : t('Click or drop more bots to add them.')}
            </span>
          </div>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={
              draftBots.length
                ? defaultRoomName(draftBots.map((b) => b.title))
                : t('Room name')
            }
            aria-label={t('Group chat name')}
            disabled={draft.busy}
            autoFocus
          />
          <div className="room-draft-actions">
            {draft.error ? (
              <span className="draft-error">{draft.error}</span>
            ) : null}
            <button
              type="button"
              className="secondary"
              onClick={() => setDraft(null)}
              disabled={draft.busy}
            >
              {t('Cancel')}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={draftBots.length < ROOM_MIN_MEMBERS || draft.busy}
            >
              {draft.busy ? t('Creating…') : t('Create')}
            </button>
          </div>
        </form>
      ) : null}
      {menu && onEdit ? (
        <div
          className="host-menu row-menu"
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 200),
            top: Math.min(menu.y, window.innerHeight - 80),
          }}
        >
          <button role="menuitem" onClick={() => onEdit(menu.bot)}>
            {t("Edit Bot")}
          </button>
        </div>
      ) : null}
    </main>
  );
}

function OneBot({
  bot,
  running,
  onOpen,
  onAsk,
  onMenu,
  pill,
}: {
  bot: Bot;
  running: boolean;
  onOpen: (bot: Bot) => void;
  onAsk: (bot: Bot, text: string) => void;
  onMenu?: (e: MouseEvent) => void;
  pill?: ReactNode;
}) {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    onAsk(bot, text.trim());
    setText("");
  };
  return (
    <section className="bot-hero">
      <button
        className="bot-hero-face"
        onClick={() => onOpen(bot)}
        onContextMenu={onMenu}
        aria-label={t('Open {name}', { name: bot.title })}
      >
        <BotAvatar bot={bot} size={168} />
      </button>
      <h2>{bot.title}</h2>
      {pill}
      {running ? (
        <span className="running">{t('Working')}</span>
      ) : bot.description ? (
        <p className="meta">{bot.description}</p>
      ) : null}
      {bot.lastLine ? (
        <button className="bot-last" onClick={() => onOpen(bot)}>
          <span>{bot.lastLine}</span>
          {bot.lastActive ? (
            <span className="meta">{timeLabel(bot.lastActive)}</span>
          ) : null}
        </button>
      ) : null}
      <form className="bot-ask" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('Ask {name}…', { name: bot.title })}
          aria-label={t('Ask {name}', { name: bot.title })}
        />
        <button
          type="submit"
          className="round send"
          aria-label={t('Send')}
          disabled={!text.trim()}
        >
          <Icon name="send" />
        </button>
      </form>
    </section>
  );
}

interface TileProps {
  bot: Bot;
  large: boolean;
  running: boolean;
  picked: boolean;
  target: boolean;
  onClick: () => void;
  onMenu?: (e: MouseEvent) => void;
  pill?: ReactNode;
  drag: Record<string, unknown>;
}

function BotTile({
  bot,
  large,
  running,
  picked,
  target,
  onClick,
  onMenu,
  pill,
  drag,
}: TileProps) {
  return (
    <button
      className={`bot-tile${large ? " large" : ""}${picked ? " picked" : ""}${target ? " drop-target" : ""}`}
      onClick={onClick}
      onContextMenu={onMenu}
      aria-pressed={picked || undefined}
      {...drag}
    >
      <span className="bot-tile-face">
        <BotAvatar bot={bot} size={large ? 128 : 84} />
        {target ? (
          <span className="drop-plus" aria-hidden="true">
            <Icon name="plus" />
          </span>
        ) : null}
      </span>
      <span className="bot-name">
        {bot.pinned ? (
          <span className="pin" aria-label={t('Pinned')}>
            •
          </span>
        ) : null}
        {bot.title}
      </span>
      {pill}
      {running ? (
        <span className="running">{t('Working')}</span>
      ) : (
        <span className="meta bot-line">
          {bot.lastLine ??
            bot.description ??
            (bot.model ? bot.model : t('No chats yet'))}
        </span>
      )}
      {bot.lastActive ? (
        <span className="meta bot-time">{timeLabel(bot.lastActive)}</span>
      ) : null}
    </button>
  );
}
