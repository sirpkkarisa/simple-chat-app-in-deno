import {
  Application,
  ResponseHandler,
} from "../mini-framework-deno/modules.ts";
import {
  getItem,
  handleJoinGroup,
  handleNewGroup,
  handleOpenPrivateChat,
  handleSendMsg,
  loadActiveUsers,
  send,
  signMsg,
  verifyMsg,
} from "./utils.ts";

const app = new Application();
const activeUsers: Map<
  string,
  WebSocket & { socketId: string; candidates?: string[]; offer?: string }
> = new Map();

app.serve({ port: 5555 });
app.router.get("/", "public:index.html");
app.router.post("/login", async (req: Request, resp: ResponseHandler) => {
  const res = await req.json();
  const uid = res["user-id"];
  const pass = res["user-password"];
  const users = getItem("users");

  if (!uid.length || !pass.length) return resp.bad_request();
  if (!users.length) return resp.unauthorized();

  const user = users.find((user) => user.uid === uid);
  if (!user) return resp.unauthorized();
  const isValid = await verifyMsg(pass, user.password as string);
  if (user.uid !== uid || !isValid) return resp.forbidden();
  return resp.json({ message: "Logged In" }).ok();
});

app.router.post(
  "/create-account",
  async (req: Request, resp: ResponseHandler) => {
    const res = await req.json();
    const uid = res["user-id"];
    const pass = res["user-password"];
    const fname = res["fname"];
    const lname = res["lname"];

    let users = getItem("users");
    if (!users) localStorage.setItem("users", JSON.stringify([]));
    if (!uid || !pass || !fname || !lname) return resp.bad_request();
    users = getItem("users");
    const user = users.findIndex((user) => user.uid === uid);
    if (user !== -1) {
      return resp.json({ message: "Email already exists" })
        .bad_request();
    }

    // hash password
    const hash = await signMsg(pass);
    users = [...users, {
      firstName: fname,
      lastName: lname,
      password: hash,
      uid,
    }];

    localStorage.setItem("users", JSON.stringify(users));
    return resp.json({ message: "Registered" }).created();
  },
);
app.router.socket(
  "/chat",
  (
    socket: WebSocket & { socketId: string; candidate?: string },
    _resp: ResponseHandler,
  ) => {
    // const socket: WebSocket & {socketId: string} = {...ws, socketId:''};
    socket.onopen = () => console.log("User connected!");
    socket.onmessage = (message: MessageEvent) => {
      const data = JSON.parse(message.data) as Record<
        string,
        Record<string, string>
      >;
      switch (data.event.type) {
        case "user-connected":
          socket.socketId = data.event.uid;
          send(socket, { type: "user-connected", socketId: data.event.uid });
          if (!activeUsers.has(data.event.uid)) {
            activeUsers.set(data.event.uid, socket);
            loadActiveUsers(activeUsers);
          }
          break;
        case "open-private-chat":
          handleOpenPrivateChat(data, socket, activeUsers);
          break;
        case "send-msg":
          handleSendMsg(data.event, socket, activeUsers);
          break;
        case "error":
          console.log(data.event);
          break;
        case "new-group":
          handleNewGroup(data.event.groupName, socket);
          break;
        case "join-group":
          handleJoinGroup(data.event.groupName, socket, activeUsers);
          break;
        case "load-groups": {
          let groups = getItem("groups");
          if (groups) {
            groups = groups.filter((group) => {
              const values = Object.values(group)[0] as Record<
                string,
                string[]
              >;
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
          const groupChats = getItem("groups");
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
          const allGroups = getItem("groups");

          try {
            const groupIndex = allGroups.findIndex((g) =>
              Object.keys(g)[0] === data.event.recipient
            );
            const [groupName, object] =
              Object.entries(allGroups[groupIndex])[0];

            const payload = {
              ...object,
              chats: [...object.chats, {
                sender: socket.socketId,
                message: data.event.message,
              }],
            };
            const obj: Record<string, unknown> = {};
            obj[groupName] = payload;
            allGroups[groupIndex] = obj;

            for (const it of activeUsers) {
              (object as Record<string, string[]>).members.forEach((member) => {
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
              offer: user!.offer,
            },
          }));

          user!.candidates!.forEach((candidate) =>
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
        default:
          console.log("Default");
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
    };
  },
);
