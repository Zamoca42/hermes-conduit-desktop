import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Bot } from "../state/bots";
import { dayLabel, roomItems, startsNewDay, type Room } from "../state/groups";
import { Fragment } from "react";
import { useRoom } from "../state/useGroups";
import { BotAvatar, RoomFaces } from "./BotsHome";
import { Composer } from "./Composer";
import { MessageActions, QuotedCard, Reply, clock, quoteRequest, revealMessage } from "./Transcript";
import { blockquote, copyableReply, parseRoomReply, roomReplyText, sameQuotedText, type QuoteRequest } from "../state/quote";
import { Icon } from "./icons";
import { PictureImage, PictureProfile } from "./Picture";
import { displayName, roomUploadProblem } from "../state/attachments";
import { keptPictures, readRoomPicture } from "../state/roomPictures";
import { t } from "@shared/i18n";

interface Props {
  room: Room;
  bots: Bot[];
  connected: boolean;
  canStop: boolean;
  /** The room's Hermes keeps files as its messages' own attachments. */
  canAttach: boolean;
}

interface ShownFile {
  kind: string;
  name: string;
  /** Where Hermes keeps it, to read a picture back. */
  attachmentId?: string;
  /** A picture's bytes already here (the sender's own, while it sends). */
  dataUrl?: string;
}

/** A picture in a room message, read back from Hermes; its name if it won't load. */
function RoomPicture({ roomId, eventId, file }: { roomId: string; eventId?: string; file: ShownFile }) {
  const [src, setSrc] = useState<string | null | undefined>(
    file.dataUrl ?? (file.attachmentId ? keptPictures.get(file.attachmentId) : null),
  );
  useEffect(() => {
    if (src !== undefined || !file.attachmentId || !eventId) return;
    let live = true;
    void readRoomPicture(roomId, eventId, file.attachmentId).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [src, roomId, eventId, file.attachmentId]);
  if (!src) {
    return (
      <span className="chip" title={file.name}>
        <Icon name="image" />
        <span>{displayName(file.name)}</span>
      </span>
    );
  }
  return <PictureImage src={src} name={file.name} className="room-picture" />;
}

/** A room message's files: pictures as themselves, the rest by name. */
function FileChips({ files, roomId, eventId }: { files: ShownFile[]; roomId: string; eventId?: string }) {
  return (
    <div className="attachments">
      {files.map((f, i) =>
        f.kind === "image" ? (
          <RoomPicture key={i} roomId={roomId} eventId={eventId} file={f} />
        ) : (
          <span key={i} className="chip" title={f.name}>
            <Icon name="file" />
            <span>{displayName(f.name)}</span>
          </span>
        ),
      )}
    </div>
  );
}

/** A group chat: the user's messages and each bot's under its face and name, read from the room's log. */
export function RoomView({ room, bots, connected, canStop, canAttach }: Props) {
  const { events, status, loading, error, pending, send, stop } = useRoom(
    room,
    connected,
  );
  const items = useMemo(() => roomItems(room, events), [room, events]);
  const botFor = (profile?: string) => bots.find((b) => b.name === profile);
  const memberBot = (memberId: string) =>
    botFor(
      room.members.find((m) => m.memberId === memberId)?.profile ?? memberId,
    );
  const busyNames = status.busy.map(
    (id) => room.members.find((m) => m.memberId === id)?.displayName ?? id,
  );

  const scroller = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items, pending, status.working]);

  // A message replying to another: the "Replying to" card, then its own words.
  const [quote, setQuote] = useState<QuoteRequest | null>(null);
  const replies = useMemo(() => {
    const map = new Map<string, { author: string; quote: string; message: string }>();
    for (const item of items) {
      if (item.kind !== "user") continue;
      const reply = parseRoomReply(item.text);
      if (reply) map.set(item.key, reply);
    }
    return map;
  }, [items]);
  const ownWords = (item: { key: string; text: string }) => replies.get(item.key)?.message ?? item.text;
  const jump = (quoted: string) => {
    const target = items.find((i) => i.kind === "member" && sameQuotedText(i.text, quoted));
    return target ? () => revealMessage(scroller.current, target.key) : undefined;
  };

  const names = room.members.map(
    (m) => m.displayName ?? m.profile ?? m.memberId,
  );
  return (
    <main className="chat room" ref={pane}>
      <div className="chat-head">
        <div className="chat-title room-title" title={names.join(", ")}>
          <RoomFaces room={room} bots={bots} size={20} />
          <span className="room-title-name">{room.name}</span>
          <span className="room-title-count">{names.length} bots</span>
        </div>
      </div>
      <div
        className="transcript"
        ref={scroller}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        <div className="transcript-inner">
          {loading ? <div className="notice">{t('Loading…')}</div> : null}
          {error ? <div className="notice error">{error}</div> : null}
          {status.disbanded ? (
            <div className="notice">{t('This group chat was disbanded.')}</div>
          ) : null}
          {!loading && !error && items.length === 0 && pending.length === 0 ? (
            <div className="welcome">
              <h2>{room.name}</h2>
              <span>
                {t('Everyone here reads what you send. Mention a bot with @ to ask just them.')}
              </span>
            </div>
          ) : null}
          {items.map((item, i) => {
            const at = item.kind === "note" ? undefined : item.at;
            const before = items
              .slice(0, i)
              .reverse()
              .find((x) => x.kind !== "note" && x.at !== undefined);
            const day =
              startsNewDay(
                before && before.kind !== "note" ? before.at : undefined,
                at,
              ) && at !== undefined ? (
                <div className="day-line">{dayLabel(at)}</div>
              ) : null;
            return (
              <Fragment key={item.key}>
                {day}
                {item.kind === "user" ? (
                  <div key={item.key} className="user" data-key={item.key}>
                    {replies.get(item.key) ? (
                      <QuotedCard
                        name={replies.get(item.key)!.author}
                        quote={replies.get(item.key)!.quote}
                        onJump={jump(replies.get(item.key)!.quote)}
                      />
                    ) : null}
                    {item.files ? <FileChips files={item.files} roomId={room.roomId} eventId={item.key} /> : null}
                    {ownWords(item).trim() ? <div className="bubble">{ownWords(item)}</div> : null}
                    <span className="time">{clock(item.at)}</span>
                    {ownWords(item).trim() ? (
                      <MessageActions
                        copy={ownWords(item)}
                        menu={[{ label: t('Quote'), onSelect: () => setQuote(quoteRequest({ text: blockquote(ownWords(item)) })) }]}
                      />
                    ) : null}
                  </div>
                ) : item.kind === "member" ? (
                  <div key={item.key} className="room-member" data-key={item.key}>
                    {memberBot(item.memberId) ? (
                      <BotAvatar bot={memberBot(item.memberId)!} size={30} />
                    ) : (
                      <span
                        className="bot-avatar blank"
                        style={{ width: 30, height: 30 }}
                      />
                    )}
                    <div className="room-member-body">
                      <div className="room-member-name">
                        {item.name}
                        <span className="time">{clock(item.at)}</span>
                      </div>
                      <div className="assistant">
                        <PictureProfile.Provider
                          value={room.members.find((m) => m.memberId === item.memberId)?.profile}
                        >
                          <Reply text={item.text} />
                        </PictureProfile.Provider>
                        <MessageActions
                          copy={copyableReply(item.text)}
                          menu={[{ label: t('Quote'), onSelect: () => setQuote(quoteRequest({ reply: { author: item.name, text: item.text } })) }]}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={item.key}
                    className={`notice${item.tone === "error" ? " error" : ""}`}
                  >
                    {item.text}
                  </div>
                )}
              </Fragment>
            );
          })}
          {pending.map((p) => (
            <div
              key={p.eventId}
              className={`user pending${p.failed ? " failed" : ""}`}
            >
              {p.attachments.length ? (
                <FileChips
                  roomId={room.roomId}
                  files={p.attachments.map((a) => ({
                    kind: a.kind,
                    name: a.name,
                    dataUrl: a.kind === "image" ? `data:${a.mime};base64,${a.base64}` : undefined,
                  }))}
                />
              ) : null}
              {parseRoomReply(p.text) ? (
                <QuotedCard name={parseRoomReply(p.text)!.author} quote={parseRoomReply(p.text)!.quote} />
              ) : null}
              {(parseRoomReply(p.text)?.message ?? p.text).trim() ? (
                <div className="bubble">{parseRoomReply(p.text)?.message ?? p.text}</div>
              ) : null}
              {p.failed ? (
                <span className="time">
                  {t('Not sent: {reason}', { reason: p.failed })}{" "}
                  <button
                    className="link"
                    onClick={() => void send(p.text, p.attachments, p.eventId)}
                  >
                    {t('Try again')}
                  </button>
                </span>
              ) : (
                <span className="time">{t('Sending…')}</span>
              )}
            </div>
          ))}
          {status.working ? (
            <div className="status-line">
              <span className="running" />
              {busyNames.length
                ? busyNames.length === 1
                  ? t('{name} is answering…', { name: busyNames[0]! })
                  : t('{names} are answering…', { names: busyNames.join(', ') })
                : t('Working…')}
            </div>
          ) : null}
        </div>
      </div>
      <Composer
        placeholder={t('Message {name}…', { name: room.name })}
        running={canStop && status.working}
        disabled={!connected || status.disbanded}
        onSend={(text, attachments) => void send(text, attachments)}
        onStop={() => void stop()}
        focusKey={room.roomId}
        canAttach={canAttach && !room.linked}
        dropZone={pane}
        checkAttachments={roomUploadProblem}
        quote={quote}
        wrapReply={(reply, draft) => roomReplyText(reply.text, reply.author, draft)}
      />
    </main>
  );
}
