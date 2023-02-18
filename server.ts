import {  signMsg,verifyMsg, resp } from "./utils.ts";

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

async function handleLogin(req:Request) {
    const res = await req.json();
    const uid = res['user-id'];
    const pass = res['user-password'];
    const users = JSON.parse(localStorage.getItem('users'));

    if(!uid || !pass) return resp.json('Bad Request',400); 
    if(!users) return resp.json('Unauthorized',401); 
    
    const user = users.find(user => user.uid === uid);
    if(!user) return resp.json('Unauthorized',401); 
    const isValid = await verifyMsg(pass,user.password)

    if(user.uid !== uid || !isValid) return resp.json('Forbidden',403); 
    return resp.json('Logged In');
}

async function handleRegistration(req:Request) {
    const res = await req.json();
    const uid = res['user-id'];
    const pass = res['user-password'];
    const fname = res['fname'];
    const lname = res['lname'];
    let users = JSON.parse(localStorage.getItem('users'));
    if(!users) localStorage.setItem('users',JSON.stringify([]));
    if(!uid || !pass || !fname || !lname) return resp.json('Bad Request',400); 
    
    users = JSON.parse(localStorage.getItem('users'));
    const user = users.findIndex(user => user.uid === uid);
    if(user !== -1) return resp.json('User Exists',403); 

    // hash password
    const hash =await signMsg(pass)
    users = [...users,{
        firstName: fname,
        lastName: lname,
        password: hash,
        uid,
    }]

    localStorage.setItem('users',JSON.stringify(users));
    return resp.json('Registered Successfully',201);
}

async function handleRequest(req: Request): Response {
    const client = "public";
    const url = new URL(req.url);
    const pathname = url.pathname;
    const userAgent = req.headers.get('user-agent');
    let options = {
        status: 200,
        statusText: 'Ok',
    };

    let data;

    // Routing
        if(pathname === '/') {
            data = await Deno.readFile(`${client}/index.html`);
        } else if(pathname.includes('/css')){
            data = await Deno.readFile(`${client}/css/style.css`);
        } else if(pathname.includes('/js')){
            data = await Deno.readFile(`${client}/js/main.js`);
        } else if(pathname.includes('/login')){
            const values = await handleLogin(req);
            
            data = values.body;
            options = {...options,...values.options};
        } else if(pathname.includes('/create-account')){
            const values = await handleRegistration(req);
            data = values.body;
            options = {...options,...values.options};        
        } else if(pathname.includes('/chat')){
            const upgrade = req.headers.get('upgrade').toLowerCase();

            if(upgrade === 'websocket') {
                const { socket, response } = await Deno.upgradeWebSocket(req);
                // socket.socketId = crypto.randomUUID();
                handleSockets(socket);
                return response;
            }
        } else {
            data = await Deno.readFile(`${client}/404.html`);
            options.status = 404;
            options.statusText = 'Not Found';
        }


    console.log(`${req.method} ${pathname}\t${userAgent}\t${new Date().toLocaleString()}\t${options.status} ${options.statusText}`)
    return new Response(data,options);
}

function handleConnection(conn:unkown) {
    const httpConn = Deno.serveHttp(conn);
    (async function(){
        for await (const reqEvent of httpConn) {
            await reqEvent.respondWith(handleRequest(reqEvent.request));
        }
    })();
}

function broadcast(msg) {
    for(const socket of activeUsers.values()) {
        if(socket && socket.readyState !== 3){
            socket.send(msg);
        }
    }
}

function loadUsers() {
    const users = Array.from(activeUsers).map(user => ({
        username: user[0],
        socketId: user[1].socketId
    }))
    broadcast(JSON.stringify({
        event: {
            type:'load-users',
            users
        }
    }))
}

function handlePrivateConversation(
    { recipient },
    socket
    ) {

    for(const sock of activeUsers.values()){
        if(sock.readyState !== 3 && sock.socketId === recipient) {
            sock.send(JSON.stringify({
                event: {
                    type: 'private-chat',
                    from: socket.socketId,
                    me:recipient
                }
            }));

            socket.send(JSON.stringify({
                event: {
                    type: 'private-chat',
                    me: socket.socketId,
                    from: recipient
                }
            }));
        }
    }
}
function handleSockets(socket) {
    socket.onopen = () => console.log('User Connected!');
    socket.onmessage = (message)=> {
        const data = JSON.parse(message.data);
        switch (data.event.type) {
            case 'user-connected':
                socket.socketId = data.event.uid;
                socket.send(JSON.stringify({
                    event: {
                        type:'user-connected',
                        socketId:socket.socketId
                    }
                }))

                if(!activeUsers.has(data.event.uid)){
                    activeUsers.set(data.event.uid,socket);
                    loadUsers();
                }
                break;
            case 'open-private-chat':
                {
                    let chats = JSON.parse(localStorage.getItem('chats'));
                    const chat = {}

                    chat[crypto.randomUUID()] = {
                        privateChats: [],
                        sender: socket.socketId,
                        recipient: data.event.recipient
                    };

                    if(!chats) {
                        localStorage.setItem('chats',JSON.stringify([]));
                        chats = JSON.parse(localStorage.getItem('chats'));
                    }

                    chats.push(chat);
                    localStorage.setItem('chats',JSON.stringify(chats));
                
                    handlePrivateConversation(data.event, socket)
                    break;
                }
            case 'send-msg':
                {
                    const { recipient,message } = data.event;
                const allChats = JSON.parse(localStorage.getItem('chats'));
                try {
                    const obj = allChats.pop();
                    const [key,values] = Object.entries(obj)[0];
                    const latestChat = {};
                    values['privateChats'].push({
                        message,
                        sender: socket.socketId
                    })
                    latestChat[key] = values;
                    allChats.push(latestChat)
                    // console.log(latestChat)
                    localStorage.setItem('chats',JSON.stringify(allChats));
                    for(const sock of activeUsers.values()){
                        if(sock.readyState !== 3 && sock.socketId === recipient) {
                            sock.send(JSON.stringify({
                                event: {
                                    type: 'send-msg',
                                    from: socket.socketId,
                                    me: recipient,
                                    chats: values

                                }
                            }));

                            socket.send(JSON.stringify({
                                event: {
                                    type: 'send-msg',
                                    me: socket.socketId,
                                    from: recipient,
                                    chats: values
                                }
                            }));
                        }
                    }
                } catch (error) {
                    console.log(allChats)
                    console.error(error.message)
                }
                break;
                }
            case 'error':
                console.log(data.event)
                break;
            default:
                break;
        }
    }
    socket.onerror = (e) => console.log("socket errored:", e);
    socket.onclose = () => {
        console.log(`${socket.socketId} has left`)
        for(const user of activeUsers) {
            if(user[1].socketId === socket.socketId) {
                activeUsers.delete(user[0])
            }
        }

        broadcast(JSON.stringify({
            event: {
                type:'user-left',
                socketId:socket.socketId
            }
        }));
    }
}

async function init(PORT: number) {
    const server = Deno.listen({port: PORT});
    console.log(`Server is running on PORT: http://localhost:${PORT}`);
    await initServerConnection(server);
}
// console.log(localStorage.getItem('chats'))
// await Deno.writeTextFile('dumpLocalStorageData.json',localStorage.getItem('chats'))
// localStorage.removeItem('chats')
// localStorage.clear()
await init(port);
