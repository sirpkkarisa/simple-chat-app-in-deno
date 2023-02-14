export async function genKey() {
    // Generate keys
    const key = await crypto.subtle.generateKey({
        name: 'RSA-PSS',
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01,0x00,0x01]),
        hash: 'SHA-256'
    },
    true,
    ['sign','verify']
    )

    const pemPrivKey = await exportPrivKeyAsPKCS8(key.privateKey);
    const pemPubKey = await exportPubKeyAsSPKI(key.publicKey);

    await Deno.writeTextFile('privKey.pem',pemPrivKey);
    await Deno.writeTextFile('pubKey.pem',pemPubKey);

    console.log('Done!')
}

async function exportPrivKeyAsPKCS8(privateKey) {
    // export the generated key
    const exported = await crypto.subtle.exportKey(
        'pkcs8',//Public Key Cryptography Standard 8
        privateKey
    );
    
    const exportedAsStr = ArrBufToStr(exported);
    const exportedAsBase64 = btoa(exportedAsStr);
    const pemExported = `-----BEGIN PRIVATE KEY-----\n${exportedAsBase64}\n-----END PRIVATE KEY-----`;

    return pemExported;
}

async function exportPubKeyAsSPKI(publicKey) {
    const exported = await crypto.subtle.exportKey(
        'spki',//Simple Public Key Infrastructure
        publicKey
    );

    const exportedAsStr = ArrBufToStr(exported);
    const exportedAsBase64 = btoa(exportedAsStr);
    const pemExported = `-----BEGIN PUBLIC KEY-----\n${exportedAsBase64}\n-----END PUBLIC KEY-----`;

    return pemExported;
}

function ArrBufToStr(buf) {
    return String.fromCharCode.apply(null,new Uint8Array(buf))
}


// module.exports = {genKey}
// await genKey()