import { resp, signMsg, verifyMsg } from "./utils.ts";

const activeUsers = new Map();

let port = 5555;

if (Deno.args.length > 2) {
  port = Deno.args[1];
}

async function initServerConnection(server: unkown): unkown {
  for await (const conn of server) {
    handleConnection(conn);
  }
}

async function handleLogin(req: Request) {
  const res = await req.json();
  const uid = res["user-id"];
  const pass = res["user-password"];
  const users = JSON.parse(localStorage.getItem("users"));

  if (!uid || !pass) return resp.json("Bad Request", 400);
  if (!users) return resp.json("Unauthorized", 401);

  const user = users.find((user) => user.uid === uid);
  if (!user) return resp.json("Unauthorized", 401);
  const isValid = await verifyMsg(pass, user.password);

  if (user.uid !== uid || !isValid) return resp.json("Forbidden", 403);
  return resp.json("Logged In");
}

async function handleRegistration(req: Request) {
  const res = await req.json();
  const uid = res["user-id"];
  const pass = res["user-password"];
  const fname = res["fname"];
  const lname = res["lname"];

  let users = JSON.parse(localStorage.getItem("users"));
  if (!users) localStorage.setItem("users", JSON.stringify([]));
  if (!uid || !pass || !fname || !lname) return resp.json("Bad Request", 400);

  users = JSON.parse(localStorage.getItem("users"));
  const user = users.findIndex((user) => user.uid === uid);
  if (user !== -1) return resp.json("User Exists", 403);

  // hash password
  const hash = await signMsg(pass);
  users = [...users, {
    firstName: fname,
    lastName: lname,
    password: hash,
    uid,
  }];

  localStorage.setItem("users", JSON.stringify(users));
  return resp.json("Registered Successfully", 201);
}

async function handleRequest(req: Request): Response {
  const client = "public";
  const url = new URL(req.url);
  const pathname = url.pathname;
  const userAgent = req.headers.get("user-agent");
  let options = {
    status: 200,
    statusText: "Ok",
  };

  let data;

  // Routing
  if (pathname === "/") {
    data = await Deno.readFile(`${client}/index.html`);
  } else if (pathname.includes("/css")) {
    data = await Deno.readFile(`${client}/css/style.css`);
  } else if (pathname.includes("/js")) {
    data = await Deno.readFile(`${client}/js/main.js`);
  } else if (pathname.includes("/login")) {
    const values = await handleLogin(req);

    data = values.body;
    options = { ...options, ...values.options };
  } else if (pathname.includes("/create-account")) {
    const values = await handleRegistration(req);
    data = values.body;
    options = { ...options, ...values.options };
  } else if (pathname.includes("/chat")) {
    const upgrade = req.headers.get("upgrade").toLowerCase();

    if (upgrade === "websocket") {
      const { socket, response } = await Deno.upgradeWebSocket(req);
      handleSockets(socket);
      return response;
    }
  } else {
    data = await Deno.readFile(`${client}/404.html`);
    options.status = 404;
    options.statusText = "Not Found";
  }

  console.log(
    `${req.method} ${pathname}\t${userAgent}\t${
      new Date().toLocaleString()
    }\t${options.status} ${options.statusText}`,
  );
  return new Response(data, options);
}

function handleConnection(conn: unkown) {
  const httpConn = Deno.serveHttp(conn);
  (async function () {
    for await (const reqEvent of httpConn) {
      await reqEvent.respondWith(handleRequest(reqEvent.request));
    }
  })();
}

function broadcast(msg) {
  for (const socket of activeUsers.values()) {
    if (socket && socket.readyState !== 3) {
      socket.send(msg);
    }
  }
}

function loadUsers() {
  const users = Array.from(activeUsers).map((user) => ({
    username: user[0],
    socketId: user[1].socketId,
  }));
  broadcast(JSON.stringify({
    event: {
      type: "load-users",
      users,
    },
  }));
}

function handlePrivateConversation(
  { recipient },
  socket,
  chats: Record<string, unkown>,
) {
  for (const sock of activeUsers.values()) {
    if (sock.readyState !== 3 && sock.socketId === recipient) {
      sock.send(JSON.stringify({
        event: {
          type: "private-chat",
          from: socket.socketId,
          me: recipient,
        },
      }));

      socket.send(JSON.stringify({
        event: {
          type: "private-chat",
          me: socket.socketId,
          from: recipient,
          chats,
        },
      }));
    }
  }
}

function handleSendMsg({ recipient, message }, socket) {
  const allChats = JSON.parse(localStorage.getItem("chats"));
  try {
    const obj = allChats.find((cht) => {
      const value = Object.values(cht)[0];
      return ((value.sender === socket.socketId ||
        value.sender === recipient) &&
        (value.recipient === socket.socketId || value.recipient === recipient));
    });

    const [key, values] = Object.entries(obj)[0];
    const latestChat = {};

    if (
      values["sender"] !== socket.socketId && values["sender"] !== recipient
    ) {
      socket.send(JSON.stringify({
        event: {
          type: "error",
          message: "choose partner",
        },
      }));
      return;
    }

    values["privateChats"].push({
      message,
      sender: socket.socketId,
    });
    latestChat[key] = values;
    allChats.push(latestChat);

    localStorage.setItem("chats", JSON.stringify(allChats));
    for (const sock of activeUsers.values()) {
      if (sock.readyState !== 3 && sock.socketId === recipient) {
        sock.send(JSON.stringify({
          event: {
            type: "send-msg",
            from: socket.socketId,
            me: recipient,
            chats: values,
          },
        }));

        socket.send(JSON.stringify({
          event: {
            type: "send-msg",
            me: socket.socketId,
            from: recipient,
            chats: values,
          },
        }));
      }
    }
  } catch (error) {
    console.log(allChats);
    console.error(error.message);
  }
}

function handleOpenPrivateChat(data, socket) {
  let chats = JSON.parse(localStorage.getItem("chats"));
  const chat = {};

  if (!chats) {
    localStorage.setItem("chats", JSON.stringify([]));
    chats = JSON.parse(localStorage.getItem("chats"));
  }

  chat[crypto.randomUUID()] = {
    privateChats: [],
    sender: socket.socketId,
    recipient: data.event.recipient,
  };

  const idx = chats.findIndex((cht) => {
    const value = Object.values(cht)[0];
    return ((value.sender === socket.socketId ||
      value.sender === data.event.recipient) &&
      (value.recipient === socket.socketId ||
        value.recipient === data.event.recipient));
  });

  if (idx === -1) {
    chats.push(chat);
    localStorage.setItem("chats", JSON.stringify(chats));
  }

  handlePrivateConversation(data.event, socket, chats[idx]);
}

function handleNewGroup(groupName, socket) {
  let groups = JSON.parse(localStorage.getItem("groups"));

  if (!groups) {
    localStorage.setItem("groups", JSON.stringify([]));
    groups = JSON.parse(localStorage.getItem("groups"));
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

  const obj = {};
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

function handleJoinGroup(groupName, socket) {
  const groups = JSON.parse(localStorage.getItem("groups"));

  if (!groups) {
    return socket.send(JSON.stringify({
      event: {
        type: "error",
        message: `Group name "${groupName}" does not exist`,
      },
    }));
  }

  const idx = groups.findIndex((grp) => Object.keys(grp)[0] === groupName);
  const values = Object.values(groups[idx])[0];
  const isMember = values.members.find((m) => m === socket.socketId);

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

function handleSockets(socket) {
  socket.onopen = () => console.log("User Connected!");
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    switch (data.event.type) {
      case "user-connected":
        socket.socketId = data.event.uid;
        socket.send(JSON.stringify({
          event: {
            type: "user-connected",
            socketId: socket.socketId,
          },
        }));

        if (!activeUsers.has(data.event.uid)) {
          activeUsers.set(data.event.uid, socket);
          loadUsers();
        }
        break;
      case "open-private-chat":
        handleOpenPrivateChat(data, socket);
        break;
      case "send-msg":
        handleSendMsg(data.event, socket);
        break;
      case "error":
        console.log(data.event);
        break;
      case "new-group":
        handleNewGroup(data.event.groupName, socket);
        break;
      case "join-group":
        handleJoinGroup(data.event.groupName, socket);
        break;
      case "load-groups": {
        let groups = JSON.parse(localStorage.getItem("groups"));
        if (groups) {
          groups = groups.filter((group) => {
            const values = Object.values(group)[0];
            if (
              values.members.find((m) => m === socket.socketId) !== undefined
            ) {
              return group;
            }
          });
        }

        socket.send(JSON.stringify({
          event: {
            type: "load-groups",
            groups: groups.map((g) => Object.keys(g)[0]),
          },
        }));
        break;
      }
      case "load-group-chats": {
        const groupChats = JSON.parse(localStorage.getItem("groups"));
        let grpChats;
        if (groupChats) {
          grpChats = groupChats.filter((group) =>
            Object.keys(group)[0] === data.event.groupName
          )[0];
        }
        // console.log(groupChats,grpChats)
        socket.send(JSON.stringify({
          event: {
            type: "load-group-chats",
            payload: grpChats,
          },
        }));
        break;
      }
      case "send-group-msg": {
        const allGroups = JSON.parse(localStorage.getItem("groups"));

        try {
          const groupIndex = allGroups.findIndex((g) =>
            Object.keys(g)[0] === data.event.recipient
          );
          const [groupName, object] = Object.entries(allGroups[groupIndex])[0];

          const payload = {
            ...object,
            chats: [...object.chats, {
              sender: socket.socketId,
              message: data.event.message,
            }],
          };
          const obj = {};
          obj[groupName] = payload;
          allGroups[groupIndex] = obj;

          for (const it of activeUsers) {
            object.members.forEach((member) => {
              if (
                member === it[0] &&
                it[1].readyState !== 3
              ) {
                it[1].send(JSON.stringify({
                  event: {
                    type: "send-group-msg",
                    payload,
                  },
                }));
              }
            });
          }
          localStorage.setItem("groups", JSON.stringify(allGroups));
        } catch (error) {
          console.log(error.message);
        }
        break;
      }
      case "store-offer":
        activeUsers.forEach((payload, socketId) => {
          if (socketId == socket.socketId) {
            payload.offer = data.event.offer;
            activeUsers.set(socketId, payload);
          }
        });
        break;
      case "send-candidate":
        socket.send(JSON.stringify({
          event: {
            type: "candidate",
            candidate: socket.candidate,
            sender: socket.socketId,
          },
        }));
        break;
      case "store-candidate":
        activeUsers.forEach((payload, socketId) => {
          if (socketId == socket.socketId) {
            payload.candidates = payload.candidates ?? [];
            payload.candidates.push(data.event.candidate);
            activeUsers.set(socketId, payload);
          }
        });

        break;
      case "accept-call": {
        const user = activeUsers.get(data.event.recipient);
        socket.send(JSON.stringify({
          event: {
            type: "offer",
            offer: user.offer,
          },
        }));

        user.candidates.forEach((candidate) =>
          socket.send(JSON.stringify({
            event: {
              type: "candidate",
              candidate,
            },
          }))
        );
        break;
      }
      case "trigger-accept":
        activeUsers.forEach((payload, socketId) => {
          if (socketId != socket.socketId) {
            payload.send(JSON.stringify({
              event: {
                type: "accept",
              },
            }));
          }
        });
        break;
      case "send-answer":
        for (const sock of activeUsers) {
          if (sock[1].readyState !== 3 && sock[0] !== socket.socketId) {
            sock[1].send(JSON.stringify({
              event: {
                type: "answer",
                answer: data.event.answer,
                sender: socket.socketId,
              },
            }));
          }
        }
        break;
    }
  };
  socket.onerror = (e) => console.log("socket errored:", e);
  socket.onclose = () => {
    console.log(`${socket.socketId} left`);
    for (const user of activeUsers) {
      if (user[1].socketId === socket.socketId) {
        activeUsers.delete(user[0]);
      }
    }

    broadcast(JSON.stringify({
      event: {
        type: "user-left",
        socketId: socket.socketId,
      },
    }));
  };
}

async function init(PORT: number) {
  const server = Deno.listen({ port: PORT });
  console.log(`Server is running: http://localhost:${PORT}`);
  await initServerConnection(server);
}
// console.log(JSON.parse(localStorage.getItem('groups')))
// await Deno.writeTextFile('dumpLocalStorageData.json',localStorage.getItem('chats'))
// localStorage.removeItem('groups')
// localStorage.clear()
await init(port);
