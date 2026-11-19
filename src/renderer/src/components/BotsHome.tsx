import { useContext, useEffect, useState, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent, type ReactNode } from "react";
import type { BotWork } from "../state/useWork";
import { timeLabel } from "../state/chats";
import { gridStep, homeLayout, keptColor, type Bot } from "../state/bots";
import { GlowContext } from "./GlowColors";
import {
  addToDraft,
  defaultRoomName,
  ROOM_MAX_MEMBERS,
  ROOM_MIN_MEMBERS,
  type Room,
} from "../state/groups";
import { starterFace } from "../state/starterFaces";
import { useAvatar, useFace } from "../state/useBots";
import { canDelete } from "../state/botActions";
import { Icon } from "./icons";
import { inviteRowLine, type RoomInvite } from "../state/roomInvites";
import { copyLine, copyRoom, isOver, type RoomCopy } from "../state/roomCopies";
import { draftLine, type RoomDraft } from "../state/roomDrafts";
import { lookPictureUrl, memberLook, type RoomLook, type RoomLooks } from "../state/roomLooks";
import { StarterFaceArt } from "./StarterFaceArt";
import { t } from "@shared/i18n";
import type { HostBadge, OtherBot } from "../state/keptHosts";
import { mixedBotKey, mixedTiles, neighbour, type MixedTile } from "../state/botOrder";
import { HostBadgeMark } from "./CombinedDashboards";

const BOT_DRAG = "application/x-conduit-bot";
/** A portrait carried to another place: its tile key (the bot's name, or the mixed grid's key). */
const BOT_MOVE = "application/x-conduit-bot-move";

/** What a bot's right-click menu can do, besides Edit Bot. */
export type BotAction = "pin" | "unpin" | "duplicate" | "hide" | "show" | "delete";

/** A bot's picture, else its starter face (on the color Hermes keeps for it, when it has one). */
/**
 * A bot's face. A moving picture plays only where the face is what you're
 * looking at (`moving`: Bots Home's portraits, the editor), as on the phone,
 * and never with Reduce Motion; everywhere else it keeps its first frame.
 */
export function BotAvatar({ bot, size, moving = false, host }: { bot: Bot; size: number; moving?: boolean; host?: string }) {
  const url = useFace(useAvatar(bot.name, bot.hasAvatar, host), moving);
  // Its ring is its chat's glow color, as on the phone.
  const color = useContext(GlowContext)(bot.name);
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

/** Another person, or another person's agent, as their own Conduit draws them (a room look), else their initial. */
export function LookFace({ look, name, size }: { look?: RoomLook; name: string; size: number }) {
  const url = lookPictureUrl(look);
  return (
    <span
      className="bot-avatar look-face"
      style={{
        width: size,
        height: size,
        background: url ? undefined : look?.color,
        color: url || !look?.color ? undefined : "#fff",
        boxShadow: look?.color ? `0 0 0 2px color-mix(in srgb, ${look.color} 25%, transparent)` : undefined,
      }}
      aria-hidden="true"
    >
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <span className="look-initial" style={{ fontSize: Math.max(8, size * 0.45) }}>
          {name.trim().charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/** A room's icon: its bots' faces overlapping, with other people's agents that have a look. */
export function RoomFaces({
  room,
  bots,
  size,
  looks,
}: {
  room: Pick<Room, "members">;
  bots: Bot[];
  size: number;
  looks?: RoomLooks;
}) {
  const shown = room.members
    .flatMap((m): ({ key: string; bot: Bot } | { key: string; look: RoomLook; name: string })[] => {
      if (m.peer) {
        const look = memberLook(looks, m);
        return look ? [{ key: `peer:${m.memberId}`, look, name: m.displayName ?? m.memberId }] : [];
      }
      const bot = bots.find((b) => b.name === (m.profile ?? m.memberId));
      return bot ? [{ key: bot.name, bot }] : [];
    })
    .slice(0, 4);
  return (
    <span className="room-faces" style={{ height: size }} aria-hidden="true">
      {shown.map((face, i) => (
        <span
          key={face.key}
          style={{ marginLeft: i ? -size * 0.38 : 0, zIndex: shown.length - i }}
        >
          {"bot" in face ? <BotAvatar bot={face.bot} size={size} /> : <LookFace look={face.look} name={face.name} size={size} />}
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
  /** Bots hidden from the list, shown under Hidden with Show. */
  hidden?: Bot[];
  onNewBot?: () => void;
  /** Pin, Duplicate, Hide, Show or Delete; answers what went wrong, if anything. */
  onAction?: (kind: BotAction, bot: Bot) => Promise<string | null>;
  notice?: string | null;
  onDismissNotice?: () => void;
  /** Invites to rooms people you've linked host, as Group chats lists them. */
  invites?: RoomInvite[];
  onOpenInvite?: (invite: RoomInvite) => void;
  /** Rooms people you've linked host that your agents are in, from this Hermes' copies: each in its invite's place. */
  copies?: RoomCopy[];
  onOpenCopy?: (copy: RoomCopy) => void;
  /** The copies an agent of yours waits in for your approval. */
  copiesWaiting?: ReadonlySet<string>;
  /** Rooms with people you've linked that haven't started: who they wait for, or why they ended. */
  drafts?: RoomDraft[];
  onOpenDraft?: (draft: RoomDraft) => void;
  /** New Group Chat: your bots, and people you've linked. */
  onNewGroup?: () => void;
  /** How the rooms over Links look, by room id: other people's agents' faces. */
  roomLooks?: Record<string, RoomLooks>;
  /** Combined dashboards: the other hosts' bots mixed in with this host's, badged, each opening through a switch. */
  otherBots?: OtherBot[];
  /** Saved Dashboards' order, by address: the mixed grid's until it's arranged. */
  savedHosts?: string[];
  /** The mixed grid's order (botOrder.ts mixedBotKey), kept on this computer. */
  mixedOrder?: string[];
  /** A mixed grid's portrait dropped on another's place (null: at the end), by their keys. */
  onMoveMixed?: (dragged: string, target: string | null, shown: string[]) => void;
  /** This host's portrait dropped on another's place (null: at the end), by bot name, among `shown`. */
  onMoveBot?: (moved: string, target: string | null, shown: string[]) => void;
  badgeFor?: (url: string) => HostBadge | null;
  onOpenOther?: (other: OtherBot) => void;
  /** The host on screen: in a combined group its bots carry its badge too, so the group reads as one set. */
  hostUrl?: string;
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
  hidden,
  onNewBot,
  onAction,
  notice,
  onDismissNotice,
  invites,
  onOpenInvite,
  copies,
  onOpenCopy,
  copiesWaiting,
  drafts,
  onOpenDraft,
  onNewGroup,
  roomLooks,
  otherBots = [],
  badgeFor,
  onOpenOther,
  hostUrl,
  savedHosts = [],
  mixedOrder = [],
  onMoveMixed,
  onMoveBot,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const act = (kind: BotAction, bot: Bot) => {
    if (!onAction) return;
    setMenu(null);
    setBusy(true);
    setActionError(null);
    void onAction(kind, bot)
      .then(setActionError)
      .finally(() => setBusy(false));
  };
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
  const layout = homeLayout((bots?.length ?? 0) + otherBots.length);
  const tileCount = (bots?.length ?? 0) + otherBots.length;
  // One grid: this host's bots in their order, or in a combined group every
  // dashboard's mixed in the group's order.
  const mixed = otherBots.length > 0 && !!hostUrl;
  const tiles: MixedTile[] = mixed
    ? mixedTiles(hostUrl!, bots ?? [], otherBots, savedHosts, mixedOrder)
    : (bots ?? []).map((bot) => ({ key: bot.name, host: hostUrl ?? "", bot, own: true }));
  const shownKeys = tiles.map((tile) => tile.key);
  const canMove = tiles.length > 1 && !!(mixed ? onMoveMixed : onMoveBot);
  const move = (dragged: string, target: string | null) => {
    if (mixed) onMoveMixed?.(dragged, target, shownKeys);
    else onMoveBot?.(dragged, target, shownKeys);
  };
  /** Move Earlier or Move Later from a bot's menu, or null at that end. */
  const step = (bot: Bot, by: -1 | 1): (() => void) | null => {
    if (!canMove) return null;
    const key = mixed ? mixedBotKey(hostUrl!, bot.name) : bot.name;
    const next = neighbour(shownKeys, key, by);
    return next ? () => move(key, next) : null;
  };
  const [dragging, setDragging] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const ownBadge = hostUrl && badgeFor ? badgeFor(hostUrl) : null;
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

  // A portrait dropped on another's face starts a room (this host's bots,
  // when it can make one); dropped anywhere else on its cell, it takes that
  // place, as an app does on the Home Screen.
  const overFace = (e: DragEvent) => !!(e.target as Element | null)?.closest?.(".bot-tile-face");
  const endDrag = () => {
    setDropTarget(null);
    setMoveTarget(null);
    setDragging(null);
  };
  const tileDrag = (tile: MixedTile) => {
    const { bot, key } = tile;
    const roomsHere = canDrag && tile.own;
    if (!roomsHere && !canMove) return {};
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        if (tile.own && canDrag) e.dataTransfer.setData(BOT_DRAG, bot.name);
        if (canMove) e.dataTransfer.setData(BOT_MOVE, key);
        e.dataTransfer.effectAllowed = "copyMove";
        setDragging(key);
      },
      onDragOver: (e: DragEvent) => {
        const types = e.dataTransfer.types;
        const room = roomsHere && types.includes(BOT_DRAG) && overFace(e) && dragging !== key;
        const moves = canMove && types.includes(BOT_MOVE) && !room;
        if (!room && !moves && !(roomsHere && types.includes(BOT_DRAG))) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = room ? "copy" : "move";
        setDropTarget(room ? bot.name : null);
        setMoveTarget(moves && dragging !== key ? key : null);
      },
      onDragLeave: () => {
        setDropTarget((t) => (t === bot.name ? null : t));
        setMoveTarget((t) => (t === key ? null : t));
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        endDrag();
        const dragged = e.dataTransfer.getData(BOT_DRAG);
        const moved = e.dataTransfer.getData(BOT_MOVE);
        if (roomsHere && dragged && (overFace(e) || !moved)) {
          if (dragged !== bot.name) join(bot.name, dragged);
          else if (draft) join(dragged);
          return;
        }
        if (moved && moved !== key) move(moved, key);
      },
      onDragEnd: endDrag,
    };
  };
  /** A drop past the last portrait, in the grid's empty space, goes to the end. */
  const gridDrop = canMove
    ? {
        onDragOver: (e: DragEvent) => {
          if (e.target !== e.currentTarget || !e.dataTransfer.types.includes(BOT_MOVE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        },
        onDrop: (e: DragEvent) => {
          if (e.target !== e.currentTarget) return;
          const moved = e.dataTransfer.getData(BOT_MOVE);
          endDrag();
          if (moved) {
            e.preventDefault();
            move(moved, null);
          }
        },
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
          <div className="bots-head">
            <h1>{t('Bots')}</h1>
            {onNewBot ? (
              <button className="secondary" onClick={onNewBot} disabled={busy}>
                <Icon name="plus" /> {t("New Bot")}
              </button>
            ) : null}
          </div>
          {notice || actionError ? (
            <p className="error-text bots-notice">
              {actionError ?? notice}{" "}
              {!actionError && onDismissNotice ? (
                <button className="link" onClick={onDismissNotice}>
                  {t("OK")}
                </button>
              ) : null}
            </p>
          ) : null}
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
          {bots && (layout !== "one" || !bots[0]) && tileCount ? (
            <div
              {...gridDrop}
              className={layout === "two" ? "bots-two" : "bots-grid"}
              style={layout === "two" ? undefined : ({ "--bot-column": `${gridStep(tileCount).column}px` } as CSSProperties)}
            >
              {tiles.map((tile) => {
                const { bot } = tile;
                if (tile.own)
                  return (
                    <BotTile
                      key={tile.key}
                      bot={bot}
                      large={layout === "two"}
                      face={layout === "two" ? 128 : gridStep(tileCount).face}
                      running={runningProfiles.has(bot.name)}
                      picked={draft?.members.includes(bot.name) ?? false}
                      target={dropTarget === bot.name}
                      moveTarget={moveTarget === tile.key}
                      onClick={() => openOrPick(bot)}
                      onMenu={openMenu?.(bot)}
                      pill={<WorkPill bot={bot} work={work?.get(bot.name)} onWork={onWork} />}
                      drag={tileDrag(tile)}
                      badge={ownBadge ? <HostBadgeMark badge={ownBadge} /> : null}
                    />
                  );
                const badge = badgeFor?.(tile.host) ?? null;
                return (
                  <BotTile
                    key={tile.key}
                    bot={bot}
                    large={layout === "two"}
                    face={layout === "two" ? 128 : gridStep(tileCount).face}
                    running={false}
                    picked={false}
                    target={false}
                    moveTarget={moveTarget === tile.key}
                    onClick={() => onOpenOther?.({ host: tile.host, bot })}
                    badge={badge ? <HostBadgeMark badge={badge} /> : null}
                    host={tile.host}
                    drag={tileDrag(tile)}
                  />
                );
              })}
            </div>
          ) : null}
          {rooms && (rooms.length > 0 || canDrag || !!onNewGroup || (invites?.length ?? 0) > 0 || (copies?.length ?? 0) > 0 || (drafts?.length ?? 0) > 0) ? (
            <section className="rooms">
              <div className="rooms-head">
                <h2>{t('Group chats')}</h2>
                {onNewGroup ? (
                  <button className="secondary rooms-new" onClick={onNewGroup}>
                    <Icon name="plus" />
                    {t('New Group Chat')}
                  </button>
                ) : null}
              </div>
              {rooms.length === 0 && !draft ? (
                <p className="meta hint">
                  {t('Drag one bot onto another to start a group chat.')}
                </p>
              ) : null}
              <div className="rooms-grid">
                {(drafts ?? []).map((draft) => (
                  <button
                    key={draft.id}
                    className={`room-tile invite-tile draft-tile ${draft.status}`}
                    onClick={() => onOpenDraft?.(draft)}
                  >
                    <span className="invite-glyph" aria-hidden="true">
                      <Icon name={draft.status === "ended" ? "bell" : "clock"} />
                    </span>
                    <span className="bot-name">{draft.name}</span>
                    <span className="meta bot-time">{draftLine(draft)}</span>
                  </button>
                ))}
                {(copies ?? []).map((copy) => (
                  <button
                    key={copy.id}
                    className={`room-tile copy-tile${isOver(copy) ? " over" : ""}`}
                    onClick={() => onOpenCopy?.(copy)}
                    aria-label={`${copy.name}, ${t("With linked people")}, ${copyLine(copy)}`}
                  >
                    <span className="copy-faces">
                      <RoomFaces room={copyRoom(copy)} bots={bots ?? []} size={44} looks={roomLooks?.[copy.roomId]} />
                      <span className="copy-badge" title={t("With linked people")}>
                        <Icon name="linked" />
                      </span>
                    </span>
                    <span className="bot-name">{copy.name}</span>
                    <span className={`meta bot-time${copiesWaiting?.has(copy.id) ? " waiting" : ""}`}>
                      {copiesWaiting?.has(copy.id) ? t("Approval needed") : copyLine(copy)}
                    </span>
                  </button>
                ))}
                {(invites ?? []).filter((invite) => !copies?.some((c) => c.id === invite.id)).map((invite) => (
                  <button
                    key={invite.id}
                    className={`room-tile invite-tile ${invite.status}`}
                    onClick={() => onOpenInvite?.(invite)}
                  >
                    <span className="invite-glyph" aria-hidden="true">
                      <Icon name={invite.status === "waiting" ? "envelope" : invite.status === "joined" ? "clock" : invite.status === "started" ? "check" : "bell"} />
                    </span>
                    <span className="bot-name">{invite.name}</span>
                    <span className="meta bot-time">{inviteRowLine(invite)}</span>
                  </button>
                ))}
                {rooms.map((room) => (
                  <button
                    key={room.roomId}
                    className="room-tile"
                    onClick={() => onOpenRoom(room)}
                  >
                    {room.linked ? (
                      // With people you've linked: the two-people mark, as rooms hosted by others carry.
                      <span className="copy-faces">
                        <RoomFaces room={room} bots={bots ?? []} size={44} looks={roomLooks?.[room.roomId]} />
                        <span className="copy-badge" title={t("With linked people")}>
                          <Icon name="linked" />
                        </span>
                      </span>
                    ) : (
                      <RoomFaces room={room} bots={bots ?? []} size={44} />
                    )}
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
          {hidden && hidden.length > 0 ? (
            <section className="rooms bots-hidden">
              <button className="link" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
                {t("Hidden")} ({hidden.length})
              </button>
              {showHidden ? (
                <ul className="bots-hidden-list">
                  {hidden.map((bot) => (
                    <li key={bot.name} className="pset-row">
                      <BotAvatar bot={bot} size={28} />
                      <span>{bot.title}</span>
                      <span className="spacer" />
                      {onAction ? (
                        <button className="secondary" disabled={busy} onClick={() => act("show", bot)}>
                          {t("Unhide")}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
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
            top: Math.min(menu.y, window.innerHeight - (onAction ? 220 : 80) - (canMove ? 72 : 0)),
          }}
        >
          <button role="menuitem" onClick={() => onEdit(menu.bot)}>
            {t("Edit Bot")}
          </button>
          {canMove ? (
            <>
              <button role="menuitem" disabled={!step(menu.bot, -1)} onClick={() => step(menu.bot, -1)?.()}>
                {t("Move Earlier")}
              </button>
              <button role="menuitem" disabled={!step(menu.bot, 1)} onClick={() => step(menu.bot, 1)?.()}>
                {t("Move Later")}
              </button>
            </>
          ) : null}
          {onAction ? (
            <>
              <button role="menuitem" disabled={busy} onClick={() => act(menu.bot.pinned ? "unpin" : "pin", menu.bot)}>
                {menu.bot.pinned ? t("Unpin") : t("Pin")}
              </button>
              <button role="menuitem" disabled={busy} onClick={() => act("duplicate", menu.bot)}>
                {t("Duplicate")}
              </button>
              <button role="menuitem" disabled={busy} onClick={() => act("hide", menu.bot)}>
                {t("Hide")}
              </button>
              {canDelete(menu.bot) ? (
                <button role="menuitem" className="danger" disabled={busy} onClick={() => act("delete", menu.bot)}>
                  {t("Delete Bot")}
                </button>
              ) : null}
            </>
          ) : null}
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
        <BotAvatar bot={bot} size={168} moving />
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
  /** The face's size: the grid's step for the bots it shows. */
  face: number;
  running: boolean;
  picked: boolean;
  target: boolean;
  /** A portrait carried here takes this one's place. */
  moveTarget?: boolean;
  onClick: () => void;
  onMenu?: (e: MouseEvent) => void;
  pill?: ReactNode;
  /** Another combined dashboard's bot: its badge on the face's corner. */
  badge?: ReactNode;
  /** Another combined dashboard's bot: the host its picture is read from. */
  host?: string;
  drag: Record<string, unknown>;
}

function BotTile({
  bot,
  large,
  face,
  running,
  picked,
  target,
  moveTarget,
  onClick,
  onMenu,
  pill,
  badge,
  host,
  drag,
}: TileProps) {
  return (
    <button
      className={`bot-tile${large ? " large" : ""}${picked ? " picked" : ""}${target ? " drop-target" : ""}${moveTarget ? " move-target" : ""}`}
      onClick={onClick}
      onContextMenu={onMenu}
      aria-pressed={picked || undefined}
      {...drag}
    >
      <span className="bot-tile-face">
        <BotAvatar bot={bot} size={face} moving host={host} />
        {target ? (
          <span className="drop-plus" aria-hidden="true">
            <Icon name="plus" />
          </span>
        ) : null}
        {/* On the face's lower edge, so the tiles in a row keep one height (1b). */}
        {pill ? <span className="bot-tile-pill">{pill}</span> : null}
        {badge ? <span className="bot-tile-badge">{badge}</span> : null}
      </span>
      <span className="bot-name">
        {bot.pinned ? (
          <span className="pin" aria-label={t('Pinned')}>
            •
          </span>
        ) : null}
        {bot.title}
      </span>
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
