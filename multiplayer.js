window.global = window

global.utility = {
    log: (e)=>{console.log("[LOG]",e)}
};

(function(){
const u32 = new Uint32Array(1),
    c32 = new Uint8Array(u32.buffer),
    f32 = new Float32Array(u32.buffer),
    u16 = new Uint16Array(1),
    c16 = new Uint8Array(u16.buffer);
let encode = function(message) {
    let headers = [],
        headerCodes = [],
        contentSize = 0,
        lastTypeCode = 0b1111,
        repeatTypeCount = 0;
    for (let block of message) {
        let typeCode = 0;
        if (block === 0 || block === false) typeCode = 0b0000;
        else if (block === 1 || block === true) typeCode = 0b0001;
        else if (typeof block === "number") {
            if (!Number.isInteger(block) || block < -0x100000000 || block >= 0x100000000) {
                typeCode = 0b1000;
                contentSize += 4;
            } else if (block >= 0) {
                if (block < 0x100) {
                    typeCode = 0b0010;
                    contentSize++;
                } else if (block < 0x10000) {
                    typeCode = 0b0100;
                    contentSize += 2;
                } else if (block < 0x100000000) {
                    typeCode = 0b0110;
                    contentSize += 4;
                }
            } else {
                if (block >= -0x100) {
                    typeCode = 0b0011;
                    contentSize++;
                } else if (block >= -0x10000) {
                    typeCode = 0b0101;
                    contentSize += 2;
                } else if (block >= -0x100000000) {
                    typeCode = 0b0111;
                    contentSize += 4;
                }
            }
        } else if (typeof block === "string") {
            let hasUnicode = false;
            for (let i = 0; i < block.length; i++) {
                if (block.charAt(i) > "\xff") hasUnicode = true;
                else if (block.charAt(i) === "\x00") {
                    console.error("Null containing string!", block);
                    throw new Error("Null containing string!");
                }
            }
            if (!hasUnicode && block.length <= 1) {
                typeCode = 0b1001;
                contentSize++;
            } else if (hasUnicode) {
                typeCode = 0b1011;
                contentSize += block.length * 2 + 2;
            } else {
                typeCode = 0b1010;
                contentSize += block.length + 1;
            }
        } else {
            console.error("Unencodable data type!", block);
            console.log(JSON.stringify(message), message.indexOf(block))
            throw new Error("Unencodable data type!");
        }
        headers.push(typeCode);
        if (typeCode === lastTypeCode) repeatTypeCount++;
        else {
            headerCodes.push(lastTypeCode);
            if (repeatTypeCount >= 1) {
                while (repeatTypeCount > 19) {
                    headerCodes.push(0b1110);
                    headerCodes.push(15);
                    repeatTypeCount -= 19;
                }
                if (repeatTypeCount === 1) headerCodes.push(lastTypeCode);
                else if (repeatTypeCount === 2) headerCodes.push(0b1100);
                else if (repeatTypeCount === 3) headerCodes.push(0b1101);
                else if (repeatTypeCount < 20) {
                    headerCodes.push(0b1110);
                    headerCodes.push(repeatTypeCount - 4);
                }
            }
            repeatTypeCount = 0;
            lastTypeCode = typeCode;
        }
    }
    headerCodes.push(lastTypeCode);
    if (repeatTypeCount >= 1) {
        while (repeatTypeCount > 19) {
            headerCodes.push(0b1110);
            headerCodes.push(15);
            repeatTypeCount -= 19;
        }
        if (repeatTypeCount === 1) headerCodes.push(lastTypeCode);
        else if (repeatTypeCount === 2) headerCodes.push(0b1100);
        else if (repeatTypeCount === 3) headerCodes.push(0b1101);
        else if (repeatTypeCount < 20) {
            headerCodes.push(0b1110);
            headerCodes.push(repeatTypeCount - 4);
        }
    }
    headerCodes.push(0b1111);
    if (headerCodes.length % 2 === 1) headerCodes.push(0b1111);
    let output = new Uint8Array((headerCodes.length >> 1) + contentSize);
    for (let i = 0; i < headerCodes.length; i += 2) {
        let upper = headerCodes[i],
            lower = headerCodes[i + 1];
        output[i >> 1] = (upper << 4) | lower;
    }
    let index = headerCodes.length >> 1;
    for (let i = 0; i < headers.length; i++) {
        let block = message[i];
        switch (headers[i]) {
            case 0b0000:
            case 0b0001:
                break;
            case 0b0010:
            case 0b0011:
                output[index++] = block;
                break;
            case 0b0100:
            case 0b0101:
                u16[0] = block;
                output.set(c16, index);
                index += 2;
                break;
            case 0b0110:
            case 0b0111:
                u32[0] = block;
                output.set(c32, index);
                index += 4;
                break;
            case 0b1000:
                f32[0] = block;
                output.set(c32, index);
                index += 4;
                break;
            case 0b1001: {
                let byte = block.length === 0 ? 0 : block.charCodeAt(0);
                output[index++] = byte;
            }
            break;
            case 0b1010:
                for (let i = 0; i < block.length; i++) output[index++] = block.charCodeAt(i);
                output[index++] = 0;
                break;
            case 0b1011:
                for (let i = 0; i < block.length; i++) {
                    let charCode = block.charCodeAt(i);
                    output[index++] = charCode & 0xff;
                    output[index++] = charCode >> 8;
                }
                output[index++] = 0;
                output[index++] = 0;
                break;
        }
    }
    return output;
};
let decode = function(packet) {
    let data = new Uint8Array(packet);
    if (data[0] >> 4 !== 0b1111) return null;
    let headers = [],
        lastTypeCode = 0b1111,
        index = 0,
        consumedHalf = true;
    while (true) {
        if (index >= data.length) return null;
        let typeCode = data[index];
        if (consumedHalf) {
            typeCode &= 0b1111;
            index++;
        } else typeCode >>= 4;
        consumedHalf = !consumedHalf;
        if ((typeCode & 0b1100) === 0b1100) {
            if (typeCode === 0b1111) {
                if (consumedHalf) index++;
                break;
            }
            let repeat = typeCode - 10;
            if (typeCode === 0b1110) {
                if (index >= data.length) return null;
                let repeatCode = data[index];
                if (consumedHalf) {
                    repeatCode &= 0b1111;
                    index++;
                } else repeatCode >>= 4;
                consumedHalf = !consumedHalf;
                repeat += repeatCode;
            }
            for (let i = 0; i < repeat; i++) headers.push(lastTypeCode);
        } else {
            headers.push(typeCode);
            lastTypeCode = typeCode;
        }
    }
    let output = [];
    for (let header of headers) {
        switch (header) {
            case 0b0000:
                output.push(0);
                break;
            case 0b0001:
                output.push(1);
                break;
            case 0b0010:
                output.push(data[index++]);
                break;
            case 0b0011:
                output.push(data[index++] - 0x100);
                break;
            case 0b0100:
                c16[0] = data[index++];
                c16[1] = data[index++];
                output.push(u16[0]);
                break;
            case 0b0101:
                c16[0] = data[index++];
                c16[1] = data[index++];
                output.push(u16[0] - 0x10000);
                break;
            case 0b0110:
                c32[0] = data[index++];
                c32[1] = data[index++];
                c32[2] = data[index++];
                c32[3] = data[index++];
                output.push(u32[0]);
                break;
            case 0b0111:
                c32[0] = data[index++];
                c32[1] = data[index++];
                c32[2] = data[index++];
                c32[3] = data[index++];
                output.push(u32[0] - 0x100000000);
                break;
            case 0b1000:
                c32[0] = data[index++];
                c32[1] = data[index++];
                c32[2] = data[index++];
                c32[3] = data[index++];
                output.push(f32[0]);
                break;
            case 0b1001: {
                let byte = data[index++];
                output.push(byte === 0 ? "" : String.fromCharCode(byte));
            }
            break;
            case 0b1010: {
                let string = "",
                    byte = 0;
                while ((byte = data[index++])) string += String.fromCharCode(byte);
                output.push(string);
            }
            break;
            case 0b1011: {
                let string = "",
                    byte = 0;
                while ((byte = data[index++] | (data[index++] << 8))) string += String.fromCharCode(byte);
                output.push(string);
            }
            break;
        }
    }
    return output;
};
window.ftEncode = encode;
window.ftDecode = decode;
})();
window.addMetaData = function (type=0, subtype=0, data){
    let arr = [];
    if(typeof(subtype) === "string"){
        arr = [type, 255]
        let i = 0;
        for(let i = 0; i < subtype.length; i++){
            arr.push(subtype.charCodeAt(i));
        }
        arr.push(0);
    }else{
        arr.push(type, subtype)
    }
    let u8arr = new Uint8Array(data.length + arr.length);
    u8arr.set(arr);
    u8arr.set(data, arr.length)
    return u8arr
}
window.getMetaData = function(u8arr){
    u8arr = new Uint8Array(u8arr);
    if(u8arr[1] === 255){
      let str = "";
      let i = 2;
      while(u8arr[i] !== 0){
        str += String.fromCharCode(u8arr[i++]);
      }
      return [u8arr[0], str, u8arr.slice(i+1)]
    }
    return [u8arr[0], u8arr[1], u8arr.slice(2)]
  },

window.creatingRoom = true;
window.connectedToWRM = false
window.roomManager = new WebSocket((window.location.protocol.includes("s")?"wss":"ws")+"://advisory-madelon-redkydudash-7741e244.koyeb.app")
window.roomManager.onopen = ()=>{
  window.roomManager.binaryType = "arraybuffer"
  window.connectedToWRM = true
  global.utility.log("Connected to WRM")
  setInterval(()=>{
    let data = new Uint8Array(2);
    data[0] = 0;
    data[1] = 1;
    window.roomManager.send(data);//ping
  }, 60000)
}

window.roomManager.onclose = () => {
  alert("Disconnected from the room manager most likely due to inactivity, please reload to reconnect!")
}

window.serverWorkerSetup = function () {
  window.serverWorker.postMessage({
    type: "startServer",
    server: {
      suffix: window.servers[window._global._selectedServer].rivetGamemode,
      gamemode: window.servers[window._global._selectedServer].serverGamemode,
    }
  });
  window.serverWorker.onmessage = function (msgEvent) {
    const data = msgEvent.data;
    switch (data.type) {
      case "clientMessage":
        // clientMessage, string
        window.roomManager.send(window.addMetaData(3, data.playerId, window.ftEncode(data.data)));
      break;
      case "serverStarted":
        window.connectSocketToServer()
      break;
      case "updatePlayers":
        // WRM, RoomUpdatePlayers
        window.roomManager.send(window.addMetaData(1, 2, window.ftEncode([data.data])))
      break;
      case "serverStartText":
        window.loadingTextStatus = data.text
        window.loadingTextTooltip = data.tip
      break;
    }
  };
}

window.WebSocket = () => {
    return {
        set onmessage(v){
            window.clientMessage = v
        },
        set onopen(v) {
            v()
        },
        send: (e)=>{
            // serverMessage, Nothing
            window.roomManager.send(window.addMetaData(2, 0, window.ftEncode(e)))
        }
    }
}

window.roomManager.onmessage = (ea) => {
  let [type, subType, e] = window.getMetaData(ea.data);
  e = window.ftDecode(e);
  
  switch(type){
    case 1: // WRM
      switch(subType){
        case 0: // Player Join
          window.serverWorker.postMessage({type:"playerToken", playerId:e[0], token:e[1]})
        case 1: // Room Update
          try{window.onWRMRoomUpdate(JSON.parse(e[0]))}catch(error){}
        break;
        case 2: // Room Created
          window.selectedRoomId = e[0]
        break;
        case 3: // Room Joined
          window.onRoomJoined()
        break;
        case 4: // Player Join
          //console.log(e)
          window.serverWorker.postMessage({type:"playerJoin", playerId:e[0]})
        break;
        case 5: // Player disconnect
          window.serverWorker.postMessage({type:"playerDc", playerId:e[0]})
        break;
      }
    break;
      
    case 2: // Server Message
      window.serverWorker.postMessage({type:"serverMessage", data: [subType, e]})
    break;
      
    case 3: // Client Message
      window.clientMessage(e)
    break;
  }
}

