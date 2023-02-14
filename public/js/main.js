const footer = document.querySelector('footer');
const drag = document.querySelector('aside span');
const dashboard = document.querySelector('.dashboard');
const forms = document.querySelector('.forms');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const openRegForm = document.getElementById('open-reg-form');
const openLogForm = document.getElementById('open-log-form');
const logout = document.getElementById('logout');
const inputMsgEl = document.querySelector('[input-msg]');
const sendBtn = document.getElementById('btn-send');
const msgForm = document.querySelector('form.input');
const usersEl = document.getElementById('users');
const topDash = document.getElementById('top');
const chatsUI = document.querySelector('ul.chats');

const SERVER_ADDR = location.origin;

let isHidden = true;
let socket;

function openPrivateChat(socketId) {
    socket.send(JSON.stringify({
        event: {
            type: 'open-private-chat',
            recipient: socketId
        }
    }))
}

function updateUsers(users) {
    const thisUser = JSON.parse(localStorage.getItem('user'))['user-id'];
    const thisUserHTML = `<h1>${thisUser}</h1> <a href="#" id="logout">Logout</a>`
    let userLI = '';

    users.forEach(user => {
        if(thisUser !==user.username) {
            userLI += `
        <li><button onclick="openPrivateChat('${user.socketId}')">${user.username}</button></li>
        `;
        }
    });

    topDash.innerHTML = thisUserHTML;
    usersEl.innerHTML = userLI;
}

function handleSocket(socket) {
    socket.addEventListener('open',(e)=> {
        const user = JSON.parse(localStorage.getItem('user'));
        if(user) {
            socket.send(JSON.stringify({
                event: {
                    type:'user-connected',
                    uid: user['user-id']
                }
            }));
        }
    });

    socket.addEventListener('message', (event) => {
        const data = JSON.parse(event.data);
        // console.log(data)
        switch (data.event.type) {
            case 'load-users':
                updateUsers(data.event.users);
                break;
            case 'private-chat':
                console.log(data.event,socket.socketId)
                socket.recipient = data.event.from;
                break;
            case 'send-msg':
                updateChatUI(data.event.chats)
                // socket.socketId = data.event.socketId;
                break;
            case 'user-connected':
                socket.socketId = data.event.socketId;
                break;
            default:
                break;
        }
    });

    socket.addEventListener('error',(e)=> {
        socket.send({
            event: {
                type:'error',
                message: e
            }
        })
        console.log('error occured')
    });

    socket.addEventListener('close',(e)=> {
       console.log('connection closed');
    })
}

function updateChatUI({ privateChats }) {
    let ui = '';

    privateChats.forEach(chat => {
        if(chat.sender === socket.socketId){
            ui += `<li class="sent">${chat.message}</li>`
        }else{
            ui += `<li class="received">${chat.message}</li>`
        }
    });

    chatsUI.innerHTML = ui;
}

function validateInputs(e){
    const obj = {};
    let isValid = true;
    for(const t of e.target) {
        if(t.tagName ==='INPUT') {
            t.classList.remove('error');
            obj[`${t.name}`] = t.value.trim();
        }

        if(t.tagName ==='INPUT' && t.value.trim().length <2) {
            isValid = false;
            t.classList.add('error');
        }
    }

    return {...obj, isValid};
}

function sendMsg(e) {
    e.preventDefault();
    const msgEl = e.target['input-msg'];
    const val = msgEl.value.trim();

    if(val.length === 0 ) return;
    if(socket) {
        console.log(socket.socketId,socket.recipient)

        socket.send(JSON.stringify({
            event: {
                type:'send-msg',
                message:val,
                recipient: socket.recipient
            }
        }))
        msgEl.value = '';
    }

}

loginForm.addEventListener('submit', async function(e){
    e.preventDefault();
    const valid = validateInputs(e);
    if(!valid.isValid) return;
    delete valid['isValid'];

    try {
        const res = await fetch(`${SERVER_ADDR}/login`,{
            method:'POST',
            headers: {
                'Content-Type':'application/json'
            },
            body: JSON.stringify(valid)
        });
        const resp  = await res.json();

        if(resp.message.indexOf('Logged In') !== -1) {
            dashboard.style.display = 'flex';
            forms.style.display = 'none';
            delete valid['user-password'];
            localStorage.setItem('user', JSON.stringify(valid));

            socket = new WebSocket(`ws://${location.host}/chat`);

            handleSocket(socket);

            return;
        }
        const div = document.createElement('div');
        div.classList.add('error');
        div.textContent = 'Wrong username/password';
        loginForm.prepend()
    } catch (error) {
        console.log(error.message);
    }

});

registerForm.addEventListener('submit', async function(e){
    e.preventDefault();
    
    const valid = validateInputs(e);
    if(!valid.isValid) return;
    delete valid['isValid'];

    try {
        console.log(valid)
        const res = await fetch(`${SERVER_ADDR}/create-account`,{
            method:'POST',
            headers: {
                'Content-Type':'application/json'
            },
            body: JSON.stringify(valid)
        });
        const data = await res.json();
        console.log(data)
    } catch (error) {
        console.log(error.message);
    }
   
});

drag.addEventListener('click',()=> {
    if(isHidden) {
        document.querySelector('aside').style.transform = `translateX(0rem)`;
        isHidden = false;
    }else {
        document.querySelector('aside').style.transform = `translateX(-92%)`;
        isHidden = true;
    }
    document.querySelector('aside').style.transition = 'all 900ms ease-in-out';
});

openRegForm.addEventListener('click',(e) =>{
    e.preventDefault();
    registerForm.style.display = 'flex';
    loginForm.style.display = 'none';
});

openLogForm.addEventListener('click',(e) =>{
    e.preventDefault();
    loginForm.style.display = 'flex';
    registerForm.style.display = 'none';
});

logout && logout.addEventListener('click',(e) =>{
    e.preventDefault();
    dashboard.style.display = 'none';
    forms.style.display = 'flex';
});

msgForm.addEventListener('submit',sendMsg);

window.addEventListener('DOMContentLoaded',async ()=>{
    const user = JSON.parse(localStorage.getItem('user'));
    if(user) {
        dashboard.style.display = 'flex';
        forms.style.display = 'none';

        try {
            
            socket = new WebSocket(`ws://${location.host}/chat`);
            handleSocket(socket);

        } catch (error) {
            console.log(error);
        }

    }
})

