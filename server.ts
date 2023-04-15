import {
  Application,
  ResponseHandler,
} from "../mini-framework-deno/modules.ts";
import {
  getItem,
  handleJoinGroup,
  handleLoadChats,
  handleLoadUsers,
  handleNewGroup,
  handleOpenPrivateChat,
  handleSendGroupMsg,
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

  const user = users.find((user: Record<string, unknown>) => user.uid === uid);
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
    const user = users.findIndex((user: Record<string, unknown>) =>
      user.uid === uid
    );
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
        case "load-groups":
          handleLoadUsers(socket);
          break;
        case "load-group-chats": {
          handleLoadChats(data.event.groupName, socket);
          break;
        }
        case "send-group-msg": {
          handleSendGroupMsg(
            activeUsers,
            socket.socketId,
            data.event.recipient,
            data.event.message,
          );
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
          send(socket, {
            type: "candidate",
            candidate: socket.candidate,
            sender: socket.socketId,
          });
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
          send(socket, {
            type: "offer",
            offer: user!.offer,
          });

          user!.candidates!.forEach((candidate) =>
            send(socket, {
              type: "candidate",
              candidate,
            })
          );
          break;
        }
        case "trigger-accept":
          activeUsers.forEach((payload, socketId) => {
            if (socketId != socket.socketId) {
              send(payload, {
                type: "accept",
              });
            }
          });
          break;
        case "send-answer":
          for (const sock of activeUsers) {
            if (sock[1].readyState !== 3 && sock[0] !== socket.socketId) {
              send(sock[1], {
                type: "answer",
                answer: data.event.answer,
                sender: socket.socketId,
              });
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
