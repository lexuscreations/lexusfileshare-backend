const express = require("express");
const { socketConfig } = require("./config/");

const app = express();
const server = require("http").createServer(app);

const IO = require("socket.io")(server, { cors: socketConfig.cors });

const socketConnectedRooms = {};
const socketConnectedRequestTempObj = {};

IO.on("connection", (socket) => {
  socket.on("sender-join", (data) => {
    socketConnectedRooms[data.uid] = {
      sender_uid: data.uid,
      sender_socketId: socket.id,
      receivers: {},
    };
    socketConnectedRequestTempObj[data.uid] = {
      receivers: {},
    };
    socket.join(data.uid);
  });

  socket.on("receiver-join", (data) => {
    if (
      [...IO.sockets.adapter.rooms].filter(
        (room) => room[0] === data.sender_uid
      ).length <= 0 ||
      !socketConnectedRooms[data.sender_uid]
    )
      return IO.to(socket.id).emit("receiver-join-failed-sender404");

    if (socketConnectedRooms[data.sender_uid].receivers[data.receiverID])
      return IO.to(socket.id).emit("receiver-already-joined-with-same-UUID");

    if (socketConnectedRooms[data.receiverID])
      return IO.to(socket.id).emit("receiver-sender-UUID-can_not-be-same");

    IO.to(socket.id).emit("joining-request-sent-confirmation");

    socketConnectedRequestTempObj[data.sender_uid].receivers[socket.id] = {
      receiverID: data.receiverID,
    };

    IO.to(socketConnectedRooms[data.sender_uid].sender_socketId).emit(
      "receiver-joining-request",
      { receiverID: data.receiverID, receiver_socketId: socket.id }
    );
  });

  socket.on("sender-accept-receiver-joining-request", (data) => {
    socketConnectedRooms[data.sender_uid].receivers[data.receiverID] = {
      receiver_socketId: data.receiver_socketId,
    };
    socket.join(data.receiver_socketId);
    IO.to(data.receiver_socketId).emit("receiver-joining-done", {
      sender_uid: data.sender_uid,
    });
    delete socketConnectedRequestTempObj[data.sender_uid].receivers[
      data.receiver_socketId
    ];
  });

  socket.on("sender-reject-receiver-joining-request", (data) => {
    IO.to(data.receiver_socketId).emit("receiver-joining-decline", {
      sender_uid: data.sender_uid,
    });
  });

  socket.on("file-meta", (data) => {
    socket.in(data.sender_uid).emit("fs-meta", data.metadata);
  });

  socket.on("fs-start", (data) => {
    socket.in(data.sender_uid).emit("fs-share");
  });

  socket.on("file-raw", (data) => {
    IO.to(
      socketConnectedRooms[data.sender_uid].receivers[data.receiverID]
        .receiver_socketId
    ).emit("fs-share", data.buffer);
  });

  socket.on("disconnect", () => {
    let flag = false;
    Object.keys(socketConnectedRequestTempObj).forEach((tempRoomID) => {
      if (socketConnectedRequestTempObj[tempRoomID].receivers[socket.id]) {
        // receiver which not approved by sender that receiver disconnected, checking for each receiver in each room
        if (socketConnectedRooms[tempRoomID]) {
          IO.to(socketConnectedRooms[tempRoomID].sender_socketId).emit(
            "receiver-disconnect-during-sender-request-approval",
            {
              receiverID:
                socketConnectedRequestTempObj[tempRoomID].receivers[socket.id]
                  .receiverID,
            }
          );
        }
        delete socketConnectedRequestTempObj[tempRoomID].receivers[socket.id];
        flag = true;
      }
    });

    if (flag) return;

    Object.keys(socketConnectedRooms).forEach((roomID) => {
      if (socketConnectedRooms[roomID].sender_socketId === socket.id) {
        // sender disconnect
        Object.keys(socketConnectedRooms[roomID].receivers).forEach(
          (receiverID) => {
            IO.to(
              socketConnectedRooms[roomID].receivers[receiverID]
                .receiver_socketId
            ).emit("sender-disconnected-from-the-room", { sender_uid: roomID });
          }
        );
        Object.keys(socketConnectedRequestTempObj[roomID].receivers).forEach(
          (receiverSID) => {
            IO.to(receiverSID).emit(
              "sender-disconnect-during-receiver-request-approval",
              { sender_uid: roomID }
            );
          }
        );
        delete socketConnectedRequestTempObj[roomID];
        delete socketConnectedRooms[roomID];
      } else {
        // checking which receiver disconnect in each room, in outer loop
        const receiversArr = Object.keys(
          socketConnectedRooms[roomID].receivers
        );
        if (receiversArr.length) {
          receiversArr.forEach((receiverID) => {
            if (
              socketConnectedRooms[roomID].receivers[receiverID]
                .receiver_socketId === socket.id
            ) {
              IO.to(socketConnectedRooms[roomID].sender_socketId).emit(
                "receiver-disconnected-from-the-room",
                { receiverID }
              );
              if (receiversArr.length === 1) {
                delete socketConnectedRooms[roomID];
              } else {
                delete socketConnectedRooms[roomID].receivers[receiverID];
              }
            }
          });
        }
      }
    });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`Socket Server Running On Port ${PORT}!`)
);
