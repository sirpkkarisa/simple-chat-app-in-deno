// deno-lint-ignore-file
import { privKey, pubKey } from "./getKeys.ts";

export async function signMsg(msg: string | undefined) {
  const encoded = new TextEncoder().encode(msg);
  const buf = await crypto.subtle.sign(
    {
      name: "RSA-PSS",
      saltLength: 32,
    },
    privKey,
    encoded,
  );

  const view = new Uint8Array(buf);
  const string = String.fromCharCode.apply(null, Array.from(view));
  const data = btoa(string);

  return data;
}

export async function verifyMsg(msg: string | undefined, signature: string) {
  const encoded = new TextEncoder().encode(msg);
  const bufStr = atob(signature);
  const buf = new ArrayBuffer(bufStr.length);
  const view = new Uint8Array(buf);

  for (let i = 0; i < bufStr.length; i++) {
    view[i] = bufStr.charCodeAt(i);
  }
  const result = await crypto.subtle.verify(
    {
      name: "RSA-PSS",
      saltLength: 32,
    },
    pubKey,
    buf,
    encoded,
  );

  return result;
}

export function getItem(item: string): Record<string, unknown>[] {
  const data = localStorage.getItem(item);
  if (!data) return [];
  return JSON.parse(data);
}
// deno-lint-ignore ban-types
export let setItem: Function;
setItem = (key: string, item: Record<string, unknown>[]) => {
  localStorage.setItem(key, JSON.stringify(item));
};

export function send(socket: WebSocket, event: Record<string, unknown>) {
  socket.send(JSON.stringify({
    event,
  }));
}

function broadcast(
  msg: Record<string, unknown>,
  activeUsers: Map<string, WebSocket>,
) {
  for (const socket of activeUsers.values()) {
    if (socket && socket.readyState !== 3) {
      send(socket, msg);
    }
  }
}

export function loadActiveUsers(
  activeUsers: Map<string, WebSocket & { socketId: string }>,
) {
  const users = Array.from(activeUsers).map((user) => ({
    username: user[0],
    socketId: user[1].socketId,
  }));
  broadcast({
    type: "load-users",
    users,
  }, activeUsers);
}

export function handleOpenPrivateChat(
  data: Record<string, Record<string, string>>,
  socket: WebSocket & { socketId: string },
  activeUsers: Map<string, WebSocket & { socketId: string }>,
) {
  const socketId = socket.socketId;
  let chats = getItem("chats");

  const chat: Record<string, unknown> = {};

  if (!chats.length) {
    setItem("chats", []);
    chats = getItem("chats");
  }

  chat[crypto.randomUUID()] = {
    privateChats: [],
    sender: socketId,
    recipient: data.event.recipient,
  };

  const idx = chats.findIndex((cht) => {
    const value = Object.values(cht)[0] as Record<string, string>;
    return ((value.sender === socketId ||
      value.sender === data.event.recipient) &&
      (value.recipient === socketId ||
        value.recipient === data.event.recipient));
  });

  if (idx === -1) {
    chats.push(chat);
    setItem("chats", chats);
  }
  handlePrivateConversation(
    data.event.recipient,
    socket,
    chats[idx],
    activeUsers,
  );
}

export function handleNewGroup(
  groupName: string,
  socket: WebSocket & { socketId: string },
) {
  let groups = getItem("groups");

  if (!groups) {
    localStorage.setItem("groups", JSON.stringify([]));
    groups = getItem("groups");
  }

  const group = groups.find((grp) => Object.keys(grp)[0] === groupName);
  if (group) {
    return socket.send(JSON.stringify({
      event: {
        type: "error",
        message: `Group name "${groupName}" already exists`,
      },
    }));
  }

  const obj: Record<string, Record<string, string[]>> = {};
  obj[groupName] = {
    members: [socket.socketId],
    chats: [],
  };
  localStorage.setItem("groups", JSON.stringify([...groups, obj]));

  socket.send(JSON.stringify({
    event: {
      type: "group-ok",
      payload: obj,
    },
  }));
}
function handlePrivateConversation(
  recipient: string,
  socket: WebSocket & { socketId: string },
  chats: Record<string, unknown>,
  activeUsers: Map<string, WebSocket & { socketId: string }>,
) {
  const socketId = socket.socketId as string;
  for (const sock of activeUsers.values()) {
    if (sock.readyState !== 3 && sock.socketId === recipient) {
      send(sock, {
        type: "private-chat",
        from: socketId,
        me: recipient,
      });
      send(socket, {
        type: "private-chat",
        me: socketId,
        from: recipient,
        chats,
      });
    }
  }
}

export function handleJoinGroup(
  groupName: string,
  socket: WebSocket & { socketId: string },
  activeUsers: Map<string, WebSocket & { socketId: string }>,
) {
  const groups = getItem("groups");

  if (!groups.length) {
    return send(socket, {
      type: "error",
      message: `Group name "${groupName}" does not exist`,
    });
  }

  const idx = groups.findIndex((grp) => Object.keys(grp)[0] === groupName);
  const values = Object.values(groups[idx])[0] as Record<string, string[]>;
  const isMember = values.members.find((m) => m == socket.socketId);

  if (!isMember) {
    values.members.push(socket.socketId);
    groups[idx][groupName] = values;
  }

  localStorage.setItem("groups", JSON.stringify(groups));

  socket.send(JSON.stringify({
    event: {
      type: "group-ok",
      payload: values,
    },
  }));

  // Notify members of a user who joined
  for (const it of activeUsers) {
    values.members.forEach((member) => {
      if (
        member === it[0] &&
        it[0] !== socket.socketId &&
        it[1].readyState !== 3
      ) {
        it[1].send(JSON.stringify({
          event: {
            type: "user-joined",
            user: socket.socketId,
          },
        }));
      }
    });
  }
}

export function handleSendMsg(
  event: Record<string, string>,
  socket: WebSocket & { socketId: string },
  activeUsers: Map<string, WebSocket & { socketId: string }>,
) {
  const allChats = getItem("chats");
  const socketId = socket.socketId;
  try {
    const index = allChats.findIndex((cht) => {
      const value = Object.values(cht)[0] as Record<string, string>;
      return ((value.sender === socketId ||
        value.sender === event.recipient) &&
        (value.recipient === socketId || value.recipient === event.recipient));
    });

    const obj = allChats[index] as Record<string, unknown>;
    const [key, values] = Object.entries(obj)[0];
    const latestChat: Record<string, unknown> = {};

    if (
      (values as Record<string, string>).sender !== socketId &&
      (values as Record<string, string>).sender !== event.recipient
    ) {
      send(socket, {
        type: "error",
        message: "choose partner",
      });
      return;
    }

    (values as Record<string, Record<string, string>>[])["privateChats"].push({
      message: event.message,
      sender: socket.socketId,
    });
    latestChat[key] = values;
    allChats[index] = latestChat;

    setItem("chats", allChats);
    for (const sock of activeUsers.values()) {
      if (sock.readyState !== 3 && sock.socketId === event.recipient) {
        send(sock, {
          type: "send-msg",
          from: socketId,
          me: event.recipient,
          chats: values,
        });

        send(socket, {
          type: "send-msg",
          me: socketId,
          from: event.recipient,
          chats: values,
        });
      }
    }
  } catch (error) {
    console.error(error.message);
  }
}
