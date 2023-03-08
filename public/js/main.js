const drag = document.querySelector("aside span");
const dashboard = document.querySelector(".dashboard");
const forms = document.querySelector(".forms");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const openRegForm = document.getElementById("open-reg-form");
const openLogForm = document.getElementById("open-log-form");
const logout = document.getElementById("logout");
const msgForm = document.querySelector("form.input");
const usersEl = document.getElementById("users");
const topDash = document.getElementById("top");
const chatsUI = document.querySelector("ul.chats");
const toggleChats = document.getElementById("toggle-group-selection");
const selectGroup = document.querySelector("#select-group ul");
const joinGroup = document.getElementById("join-group");
const newGroup = document.getElementById("new-group");
const myGroups = document.getElementById("my-groups");

const SERVER_ADDR = location.origin;

let isHidden = true;
let isGroup = false;
let socket;
let isJoinGroup = true;
let isNewGroup = true;
let isMyGroups = true;

function _openPrivateChat(socketId) {
  socket.send(JSON.stringify({
    event: {
      type: "open-private-chat",
      recipient: socketId,
    },
  }));
}

function updateUsers(users) {
  const thisUser = JSON.parse(localStorage.getItem("user"))["user-id"];
  const thisUserHTML =
    `<h1>${thisUser}</h1> <a href="#" id="logout">Logout</a>`;
  let userLI = "";

  users.forEach((user) => {
    if (thisUser !== user.username) {
      userLI += `
        <li><button onclick="_openPrivateChat('${user.socketId}')">${user.username}</button></li>
        `;
    }
  });

  topDash.innerHTML = thisUserHTML;
  usersEl.innerHTML = userLI;
}

function _openGroupChats(groupName) {
  socket.send(JSON.stringify({
    event: {
      type: "load-group-chats",
      groupName,
    },
  }));
}

function loadGroups(data) {
  const groupsDiv = document.createElement("div");
  let li = "";

  data.event.groups.forEach((g) => {
    li += `<li><button onclick="_openGroupChats('${g}')">${g}</button></li>`;
  });
  groupsDiv.innerHTML = `<ul>${li}</ul>`;

  groupsDiv.classList.add("my-groups");
  if (isMyGroups) {
    dashboard.append(groupsDiv);
    isMyGroups = false;
  } else {
    document.querySelector(".my-groups").remove();
    isMyGroups = true;
  }
}

function handleSocket(socket) {
  socket.addEventListener("open", () => {
    const user = JSON.parse(localStorage.getItem("user"));
    if (user) {
      socket.send(JSON.stringify({
        event: {
          type: "user-connected",
          uid: user["user-id"],
        },
      }));
    }
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    switch (data.event.type) {
      case "load-users":
        updateUsers(data.event.users);
        break;
      case "private-chat":
        socket.isActive = "private";
        socket.recipient = data.event.from;
        if (data.event.chats) {
          updateChatUI(Object.values(data.event.chats)[0].privateChats);
        }
        break;
      case "send-msg":
        updateChatUI(data.event.chats.privateChats);
        break;
      case "user-connected":
        socket.socketId = data.event.socketId;
        break;
      case "user-left":
        console.log(data.event);
        break;
      case "error":
        console.log(data.event);
        break;
      case "group-ok":
        console.log(data.event);
        break;
      case "user-joined":
        console.log(data.event);
        break;
      case "load-groups":
        loadGroups(data);
        break;
      case "load-group-chats": {
        socket.isActive = "group";
        const object = Object.entries(data.event.payload)[0];
        if (object[0] !== "members") socket.groupName = object[0];
        if (object[1].chats) updateChatUI(object[1].chats);
        break;
      }
      case "send-group-msg":
        updateChatUI(data.event.payload.chats);
        break;
      default:
        break;
    }
  });

  socket.addEventListener("error", (e) => {
    socket.send({
      event: {
        type: "error",
        message: e,
      },
    });
    console.log("error occured");
  });

  socket.addEventListener("close", () => {
    console.log("connection closed");
  });
}

function updateChatUI(chats) {
  let ui = "";
  chats.forEach((chat) => {
    if (chat.sender === socket.socketId) {
      ui += `<li class="sent">${chat.message}</li>`;
    } else {
      ui += `<li class="received">${chat.message}</li>`;
    }
  });

  chatsUI.innerHTML = ui;
  document.querySelector("header h1").textContent =
    socket.isActive === "private" ? socket.recipient : socket.groupName;
}

function validateInputs(e) {
  const obj = {};
  let isValid = true;
  for (const t of e.target) {
    if (t.tagName === "INPUT") {
      t.classList.remove("error");
      obj[`${t.name}`] = t.value.trim();
    }

    if (t.tagName === "INPUT" && t.value.trim().length < 2) {
      isValid = false;
      t.classList.add("error");
    }
  }

  return { ...obj, isValid };
}

function sendMsg(e) {
  e.preventDefault();
  const msgEl = e.target["input-msg"];
  const val = msgEl.value.trim();

  if (val.length === 0) return;
  if (socket) {
    let type, recipient;

    if (socket.isActive === "private") {
      type = "send-msg";
      recipient = socket.recipient;
    } else {
      type = "send-group-msg";
      recipient = socket.groupName;
    }
    console.log(socket, recipient);
    socket.send(JSON.stringify({
      event: {
        message: val,
        type,
        recipient,
      },
    }));
    msgEl.value = "";
  }
}

loginForm.addEventListener("submit", async function (e) {
  e.preventDefault();
  const valid = validateInputs(e);
  if (!valid.isValid) return;
  delete valid["isValid"];

  try {
    const res = await fetch(`${SERVER_ADDR}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(valid),
    });
    const resp = await res.json();

    if (resp.message.indexOf("Logged In") !== -1) {
      dashboard.style.display = "flex";
      forms.style.display = "none";
      delete valid["user-password"];
      localStorage.setItem("user", JSON.stringify(valid));

      socket = new WebSocket(`ws://${location.host}/chat`);

      handleSocket(socket);

      return;
    }
    const div = document.createElement("div");
    div.classList.add("error");
    div.textContent = "Wrong username/password";
    loginForm.prepend();
  } catch (error) {
    console.log(error.message);
  }
});

registerForm.addEventListener("submit", async function (e) {
  e.preventDefault();

  const valid = validateInputs(e);
  if (!valid.isValid) return;
  delete valid["isValid"];

  try {
    console.log(valid);
    const res = await fetch(`${SERVER_ADDR}/create-account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(valid),
    });
    const data = await res.json();
    console.log(data);
  } catch (error) {
    console.log(error.message);
  }
});

drag.addEventListener("click", () => {
  if (isHidden) {
    document.querySelector("aside").style.transform = `translateX(0rem)`;
    isHidden = false;
  } else {
    document.querySelector("aside").style.transform = `translateX(-92%)`;
    isHidden = true;
  }
  document.querySelector("aside").style.transition = "all 900ms ease-in-out";
});

openRegForm.addEventListener("click", (e) => {
  e.preventDefault();
  registerForm.style.display = "flex";
  loginForm.style.display = "none";
});

openLogForm.addEventListener("click", (e) => {
  e.preventDefault();
  loginForm.style.display = "flex";
  registerForm.style.display = "none";
});

logout && logout.addEventListener("click", (e) => {
  e.preventDefault();
  dashboard.style.display = "none";
  forms.style.display = "flex";
});

toggleChats.addEventListener("click", () => {
  if (isGroup) {
    selectGroup.style.display = "none";
    isGroup = false;
  } else {
    selectGroup.style.display = "block";
    isGroup = true;
  }
});

msgForm.addEventListener("submit", sendMsg);

joinGroup.addEventListener("click", () => {
  const formDiv = document.createElement("div");

  formDiv.innerHTML = `
    <form id="join-form" onsubmit="_joinForm(event)">
    <div>
        <label>Group Name:</label>
        <input type="text" name="group-name">
    </div>
    <button type="submit">Join</button>
    </form>
  `;

  formDiv.classList.add("join-div");
  if (!isNewGroup) {
    document.querySelector(".new-div").remove();
    isNewGroup = !isNewGroup;
  }

  if (isJoinGroup) {
    dashboard.append(formDiv);
    isJoinGroup = false;
  } else {
    document.querySelector(".join-div").remove();
    isJoinGroup = true;
  }
});

newGroup.addEventListener("click", () => {
  const formDiv = document.createElement("div");

  formDiv.innerHTML = `
    <form id="new-form" onsubmit="_newForm(event)">
    <div>
        <label>Group Name:</label>
        <input type="text" name="group-name">
    </div>
    <button type="submit">New Group</button>
    </form>
  `;

  formDiv.classList.add("new-div");
  if (!isJoinGroup) document.querySelector(".join-div").remove();
  if (isNewGroup) {
    dashboard.append(formDiv);
    isNewGroup = false;
  } else {
    document.querySelector(".new-div").remove();
    isNewGroup = true;
  }
});

myGroups.addEventListener("click", () => {
  socket.send(JSON.stringify({
    event: {
      type: "load-groups",
      user: socket.socketId,
    },
  }));
});

const _newForm = (e) => {
  e.preventDefault();
  const groupName = e.target["group-name"];
  if (groupName.value.trim().length < 3) {
    alert("Group Name is too short!");
    return;
  }

  socket.send(JSON.stringify({
    event: {
      type: "new-group",
      groupName: groupName.value.trim(),
    },
  }));
};

const _joinForm = (e) => {
  e.preventDefault();

  const groupName = e.target["group-name"];
  if (groupName.value.trim().length === 0) {
    alert("Enter group name");
    return;
  }

  socket.send(JSON.stringify({
    event: {
      type: "join-group",
      groupName: groupName.value.trim(),
    },
  }));
};

addEventListener("DOMContentLoaded", () => {
  const user = JSON.parse(localStorage.getItem("user"));
  if (user) {
    dashboard.style.display = "flex";
    forms.style.display = "none";

    try {
      socket = new WebSocket(`ws://${location.host}/chat`);
      handleSocket(socket);
    } catch (error) {
      console.log(error);
    }
  }
});
