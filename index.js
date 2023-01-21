const express = require("express");
const { socketConfig } = require("./config/");

const app = express();
const server = require("http").createServer(app);

const IO = require("socket.io")(server, { cors: socketConfig.cors });

const socketConnectedRooms = {};
const socketConnectedRequestTempObj = {};

IO.on("connection", (socket) => {
  socket.on("sender-join", (data) => {
    if (
      socketConnectedRooms[data.uid] &&
      socketConnectedRooms[data.uid].sender_socketId !== socket.id
    ) {
      return IO.to(socket.id).emit("sender-already-joined-with-same-UUID", {
        justOnlyShowToast: false,
        isThisEnableSharingRequest: true,
      });
    }

    socketConnectedRooms[data.uid] = {
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

    if (
      Object.keys(
        socketConnectedRequestTempObj[data.sender_uid].receivers
      ).filter((key) => key === data.receiverID).length > 0
    )
      return IO.to(socket.id).emit(
        "receiver-one-previous-request-is-already-in-pending-state"
      );

    IO.to(socket.id).emit("joining-request-sent-confirmation");

    socketConnectedRequestTempObj[data.sender_uid].receivers[data.receiverID] =
      {
        receiver_socketId: socket.id,
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
      data.receiverID
    ];
  });

  socket.on("sender-reject-receiver-joining-request", (data) => {
    IO.to(data.receiver_socketId).emit("receiver-joining-decline", {
      sender_uid: data.sender_uid,
    });
    delete socketConnectedRequestTempObj[data.sender_uid].receivers[
      data.receiverID
    ];
  });

  socket.on(
    "sender-requestToCheck-isSharingEnabled-isRoomCreated-isInTheRoomAlready",
    (data) => {
      if (
        socketConnectedRooms[data.sender_uid] &&
        socketConnectedRooms[data.sender_uid].sender_socketId !== socket.id
      )
        return IO.to(socket.id).emit("sender-already-joined-with-same-UUID", {
          justOnlyShowToast: data.justOnlyShowToast,
        });

      IO.to(socket.id).emit(
        "sender-responseToCheck-isSharingEnabled-isRoomCreated-isInTheRoomAlready",
        {
          isSharingEnabled: !!socketConnectedRooms[data.sender_uid],
          isThisEnableSharingRequest: data.isThisEnableSharingRequest,
        }
      );
    }
  );

  socket.on("file-meta", (data) => {
    IO.to(
      socketConnectedRooms[data.sender_uid].receivers[data.receiverID]
        .receiver_socketId
    ).emit("fs-meta", data.metadata);
  });

  socket.on("fs-start", (data) => {
    IO.to(socketConnectedRooms[data.sender_uid].sender_socketId).emit(
      "fs-share",
      { receiverID: data.receiverID }
    );
  });

  socket.on("file-raw", (data) => {
    IO.to(
      socketConnectedRooms[data.sender_uid].receivers[data.receiverID]
        .receiver_socketId
    ).emit("fs-share", data.buffer);
  });

  socket.on("disconnect", () => {
    let flag = false;
    Object.keys(socketConnectedRequestTempObj).forEach(
      (tempRoomID__aka_senderID) => {
        Object.keys(
          socketConnectedRequestTempObj[tempRoomID__aka_senderID].receivers
        ).forEach((tempObj__receiverID) => {
          if (
            socketConnectedRequestTempObj[tempRoomID__aka_senderID].receivers[
              tempObj__receiverID
            ].receiver_socketId === socket.id
          ) {
            if (socketConnectedRooms[tempRoomID__aka_senderID]) {
              IO.to(
                socketConnectedRooms[tempRoomID__aka_senderID].sender_socketId
              ).emit("receiver-disconnect-during-sender-request-approval", {
                receiverID: tempObj__receiverID,
              });
            }
            delete socketConnectedRequestTempObj[tempRoomID__aka_senderID]
              .receivers[tempObj__receiverID];
            flag = true;
          }
        });
      }
    );

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
          (receiverID) => {
            IO.to(
              socketConnectedRequestTempObj[roomID].receivers[receiverID]
                .receiver_socketId
            ).emit("sender-disconnect-during-receiver-request-approval", {
              sender_uid: roomID,
            });
          }
        );
        delete socketConnectedRequestTempObj[roomID];
        delete socketConnectedRooms[roomID];
        IO.in(roomID).socketsLeave(roomID);
      } else {
        // checking which receiver disconnect in each room, in outer loop
        Object.keys(socketConnectedRooms[roomID].receivers).forEach(
          (receiverID) => {
            if (
              socketConnectedRooms[roomID].receivers[receiverID]
                .receiver_socketId === socket.id
            ) {
              IO.to(socketConnectedRooms[roomID].sender_socketId).emit(
                "receiver-disconnected-from-the-room",
                { receiverID }
              );
              delete socketConnectedRooms[roomID].receivers[receiverID];
            }
          }
        );
      }
    });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`Socket Server Running On Port ${PORT}!`)
);
