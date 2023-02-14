function StrToArrBuf(str) {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);

    for (let i = 0; i < str.length; i++) {
        bufView[i] = str.charCodeAt(i);
    }

    return buf
}

async function importPrivKey(pem) {
    const pemHeader = '-----BEGIN PRIVATE KEY-----';
    const pemFooter = '-----END PRIVATE KEY-----';

    const pemContents = pem.substring(pemHeader.length,pem.length - pemFooter.length);

    // base64 to binary data
    const binDerStr = atob(pemContents);
    const binDer = StrToArrBuf(binDerStr)

    return await crypto.subtle.importKey(
        'pkcs8',
        binDer,
        {
            name:'RSA-PSS',
            hash: 'SHA-256'
        },
        true,
        ['sign']
    )

}

async function importPubKey(pem) {
    // fetch the part of the PEM string between header and footer
    const pemHeader = "-----BEGIN PUBLIC KEY-----";
    const pemFooter = "-----END PUBLIC KEY-----";
    const pemContents = pem.substring(pemHeader.length, pem.length - pemFooter.length);
    // base64 decode the string to get the binary data
    const binaryDerString = atob(pemContents);
    // convert from a binary string to an ArrayBuffer
    const binaryDer = StrToArrBuf(binaryDerString);

    return await crypto.subtle.importKey(
      "spki",
      binaryDer,
      {
        name: "RSA-PSS",
        hash: "SHA-256"
      },
      true,
      ["verify"]
    );
  }

const privFile = await Deno.readTextFile('privKey.pem');
const pubFile = await Deno.readTextFile('pubKey.pem');

export const privKey = await importPrivKey(privFile);
export const pubKey = await importPubKey(pubFile);

// console.log(privKey,pubKey)
// module.exports = {privKey,pubKey}