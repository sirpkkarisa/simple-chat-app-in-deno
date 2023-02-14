import {privKey,pubKey} from "./getKeys.ts";


export async function signMsg(msg) {
    const encoded = new TextEncoder().encode(msg);
    const buf = await crypto.subtle.sign(
        {
        name: "RSA-PSS",
        saltLength: 32,
        },
        privKey,
        encoded
    );

    const view = new Uint8Array(buf)
    const string = String.fromCharCode.apply(null,view)
    const data = btoa(string)

    return data
}

export async function verifyMsg(msg,signature) {
    const encoded = new TextEncoder().encode(msg);
    const bufStr = atob(signature)
    const buf = new ArrayBuffer(bufStr.length)
    const view = new Uint8Array(buf)

    for(let i=0; i< bufStr.length;i++) {
        view[i] = bufStr.charCodeAt(i)
    }
    const result = await crypto.subtle.verify(
        {
          name: "RSA-PSS",
          saltLength: 32,
        },
        pubKey,
        buf,
        encoded
      );

      return result
}

export const resp = {
    json: function(msg='Ok',status=200){
        return {
            body: JSON.stringify({
                message:msg
            }),
            options: {
                status,
                statusText:msg,
                headers: {
                    'content-type':'application/json'
                }
            }
        }; 
    }
};

// const msg = prompt('Enter message to sign: ')
// const signature = await signMsg(msg)

// console.log(`ENCRYPTED: ${msg}\n ${signature}`)
// console.log(`VALID: ${await verifyMsg(msg,signature)}`)