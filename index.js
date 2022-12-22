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

    socketConnectedRequestTempObj[socket.id] = {
      receiverID: data.receiverID,
      sender_uid: data.sender_uid,
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
    delete socketConnectedRequestTempObj[data.receiver_socketId];
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
    if (socketConnectedRequestTempObj[socket.id]) {
      // receiver  which  not approved by sender that receiver disconnected
      if (
        socketConnectedRooms[
          socketConnectedRequestTempObj[socket.id].sender_uid
        ]
      ) {
        IO.to(
          socketConnectedRooms[
            socketConnectedRequestTempObj[socket.id].sender_uid
          ].sender_socketId
        ).emit("receiver-disconnect-during-sender-request-approval", {
          receiverID: socketConnectedRequestTempObj[socket.id].receiverID,
        });
      } else {
        delete socketConnectedRequestTempObj[socket.id];
      }
    }

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
        delete socketConnectedRooms[roomID];
      } else {
        // checking which receiver disconnect in each room, in outer loop
        const receiversArr = Object.keys(
          socketConnectedRooms[roomID].receivers
        );
        if (receiversArr.length < 1) {
          delete socketConnectedRooms[roomID];
        } else {
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
