// Muaz Khan      - www.MuazKhan.com
// MIT License    - www.WebRTC-Experiment.com/licence
// Documentation  - github.com/muaz-khan/RTCMultiConnection

module.exports = exports = function(app, socketCallback) {
    // all users are kept in this array
    var listOfUsers = {};

    // all rooms are kept in this array
    var listOfRooms = {};

    // i.e. ask first participant to become next room-controller
    var shiftRoomControl = {};

    var io = require('socket.io');

    try {
        // use latest socket.io
        io = io(app);
        io.on('connection', onConnection);
    } catch (e) {
        // otherwise fallback
        io = io.listen(app, {
            log: false,
            origins: '*:*'
        });

        io.set('transports', [
            'websocket',
            'xhr-polling',
            'jsonp-polling'
        ]);

        io.sockets.on('connection', onConnection);
    }

    // to secure your socket.io usage: (via: docs/tips-tricks.md)
    // io.set('origins', 'https://domain.com');

    function appendUser(socket) {
        var alreadyExist = listOfUsers[socket.userid];
        var extra = {};

        if (alreadyExist && alreadyExist.extra) {
            extra = alreadyExist.extra;
        }

        var params = socket.handshake.query;

        if (params.extra) {
            try {
                if (typeof params.extra === 'string') {
                    params.extra = JSON.parse(params.extra);
                }
                extra = params.extra;
            } catch (e) {
                extra = params.extra;
            }
        }

        listOfUsers[socket.userid] = {
            socket: socket,
            extra: extra || {}
        };
    }

    function openOrJoin(socket, roomid, callback) {
        var room = listOfRooms[roomid];

        if (room && room.participants.length) {
            listOfRooms[roomid].participants.push(socket.userid);
            listOfUsers[socket.userid].roomid = roomid;

            callback(false, listOfRooms[roomid].initiator);
            return;
        }

        // todo: allow user to join multiple rooms?
        listOfUsers[socket.userid].roomid = roomid;

        var params = socket.handshake.query;

        room = {
            participants: [socket.userid],
            initiator: socket.userid,
            isPublic: false,
            maxParticipantsAllowed: params.maxParticipantsAllowed || 1000
        };

        listOfRooms[roomid] = room;

        callback(true, room.initiator);
    }

    function getMyRoomSockets(socket) {
        if (!listOfUsers[socket.userid] || !listOfUsers[socket.userid].roomid) {
            return [];
        }

        return getSocketsByRoomId(socket, listOfUsers[socket.userid].roomid);
    }

    function getSocketsByRoomId(socket, roomid) {
        var array = [];

        var room = listOfRooms[roomid];
        if (!room) return array;

        room.participants.forEach(function(pid) {
            var user = listOfUsers[pid];
            if (!user || user.roomid !== roomid || pid === socket.userid) return;
            array.push(user.socket);
        });

        return array;
    }

    function onConnection(socket) {
        var params = socket.handshake.query;
        var socketMessageEvent = params.msgEvent || 'RTCMultiConnection-Message';

        var sessionid = params.sessionid;
        var autoCloseEntireSession = params.autoCloseEntireSession;

        if (params.enableScalableBroadcast) {
            // for scalable-broadcast demos
            var ScalableBroadcast = require('./Scalable-Broadcast.js');
            ScalableBroadcast(socket, params.maxRelayLimitPerUser);
        }

        if (!!listOfUsers[params.userid]) {
            params.dontUpdateUserId = true;

            var useridAlreadyTaken = params.userid;
            params.userid = (Math.random() * 1000).toString().replace('.', '');
            socket.emit('userid-already-taken', useridAlreadyTaken, params.userid);
            // maybe "return" here to ignore below codes?
        }

        socket.userid = params.userid;
        appendUser(socket);

        if (autoCloseEntireSession == 'false' && sessionid == socket.userid) {
            socket.shiftModerationControlBeforeLeaving = true;
        }

        socket.on('open-or-join', function(roomid, callback) {
            openOrJoin(socket, roomid, callback || function() {});
        });

        socket.on('shift-moderator-control-on-disconnect', function() {
            socket.shiftModerationControlBeforeLeaving = true;
        });

        socket.on('extra-data-updated', function(extra) {
            if (!listOfUsers[socket.userid]) return;
            listOfUsers[socket.userid].extra = extra;

            // if he didn't join a room yet
            if (!listOfUsers[socket.userid].roomid) return;

            // get his roomid
            var roomid = listOfUsers[socket.userid];

            // get all users from his room
            getSocketsByRoomId(socket, roomid).forEach(function(s) {
                s.emit('extra-data-updated', socket.userid, extra);
            });
        });

        socket.on('get-remote-user-extra-data', function(remoteUserId, callback) {
            callback = callback || function() {};
            if (!remoteUserId || !listOfUsers[remoteUserId]) {
                callback('remoteUserId (' + remoteUserId + ') does NOT exist.');
                return;
            }
            callback(listOfUsers[remoteUserId].extra);
        });

        socket.on('become-a-public-moderator', function() {
            if (!listOfUsers[socket.userid]) return;
            listOfUsers[socket.userid].isPublic = true;
        });

        var dontDuplicateListeners = {};
        socket.on('set-custom-socket-event-listener', function(customEvent) {
            if (dontDuplicateListeners[customEvent]) return;
            dontDuplicateListeners[customEvent] = customEvent;

            socket.on(customEvent, function(message) {
                socket.broadcast.emit(customEvent, message);
            });
        });

        socket.on('dont-make-me-moderator', function() {
            if (!listOfUsers[socket.userid]) return;
            listOfUsers[socket.userid].isPublic = false;
        });

        socket.on('get-public-moderators', function(userIdStartsWith, callback) {
            userIdStartsWith = userIdStartsWith || '';
            var allPublicModerators = [];
            for (var moderatorId in listOfUsers) {
                if (listOfUsers[moderatorId].isPublic && moderatorId.indexOf(userIdStartsWith) === 0 && moderatorId !== socket.userid) {
                    var moderator = listOfUsers[moderatorId];
                    allPublicModerators.push({
                        userid: moderatorId,
                        extra: moderator.extra
                    });
                }
            }

            callback(allPublicModerators);
        });

        socket.on('changed-uuid', function(newUserId, callback) {
            callback = callback || function() {};

            if (params.dontUpdateUserId) {
                delete params.dontUpdateUserId;
                return;
            }

            if (listOfUsers[socket.userid] && listOfUsers[socket.userid].socket.userid == socket.userid) {
                if (newUserId === socket.userid) return;

                var oldUserId = socket.userid;
                listOfUsers[newUserId] = listOfUsers[oldUserId];
                listOfUsers[newUserId].socket.userid = socket.userid = newUserId;
                delete listOfUsers[oldUserId];

                callback();
                return;
            }

            socket.userid = newUserId;
            appendUser(socket);

            callback();
        });

        socket.on('set-password', function(password) {
            if (listOfUsers[socket.userid]) {
                listOfUsers[socket.userid].password = password;
            }
        });

        socket.on('disconnect-with', function(remoteUserId, callback) {
            if (listOfUsers[socket.userid] && listOfUsers[socket.userid].roomid) {
                var roomid = listOfUsers[socket.userid].roomid;
                getSocketsByRoomId(socket, roomid).forEach(function(s) {
                    if (s.userid === remoteUserId) {
                        s.emit('user-disconnected', remoteUserId);
                    }
                });
            }
            callback();
        });

        socket.on('close-entire-session', function(callback) {
            if (listOfUsers[socket.userid] && listOfUsers[socket.userid].roomid) {
                var roomid = listOfUsers[socket.userid].roomid;
                getSocketsByRoomId(socket, roomid).forEach(function(s) {
                    s.emit('closed-entire-session', socket.userid, listOfUsers[socket.userid].extra);
                });
            }

            delete shiftRoomControl[socket.userid];
            callback();
        });

        socket.on('check-presence', function(roomid, callback) {
            var room = listOfRooms[roomid];
            if (!room || !room.participants.length) {
                callback(false, roomid, {});
                return;
            }

            var user = listOfUsers[room.initiator];
            if (user) {
                // room initiator can pass extra information
                callback(true, roomid, user.extra || {});
            } else {
                callback(true, roomid, {});
            }
        });

        function onMessageCallback(message) {
            getMyRoomSockets(socket).forEach(function(s) {
                message.extra = listOfUsers[socket.userid].extra;
                s.emit(socketMessageEvent, message);
            });
        }

        function joinARoom(message) {
            var roomInitiator = listOfUsers[message.remoteUserId];

            if (!roomInitiator || !roomInitiator.roomid) {
                return;
            }

            // fire "room-full" based on "maxParticipantsAllowed"
            getSocketsByRoomId(socket, roomInitiator.roomid).forEach(function(s) {
                message.remoteUserId = s.userid;
                s.emit(socketMessageEvent, message);
            });
        }

        socket.on('get-initiator-userid', function(roomid, callback) {
            var room = listOfRooms[roomid];

            if (room && room.initiator && listOfUsers[room.initiator]) {
                callback(room.initiator);
                return;
            }

            callback(false);
        });

        var numberOfPasswordTries = 0;
        socket.on(socketMessageEvent, function(message, callback) {
            if (message.remoteUserId && message.remoteUserId === socket.userid) {
                // remoteUserId MUST be unique
                return;
            }

            if (message.remoteUserId && message.remoteUserId != 'system' && message.message.newParticipationRequest) {
                if (listOfUsers[message.remoteUserId] && listOfUsers[message.remoteUserId].password) {
                    if (numberOfPasswordTries > 3) {
                        socket.emit('password-max-tries-over', message.remoteUserId);
                        return;
                    }

                    if (!message.password) {
                        numberOfPasswordTries++;
                        socket.emit('join-with-password', message.remoteUserId);
                        return;
                    }

                    if (message.password != listOfUsers[message.remoteUserId].password) {
                        numberOfPasswordTries++;
                        socket.emit('invalid-password', message.remoteUserId, message.password);
                        return;
                    }
                }

                if (listOfUsers[message.remoteUserId]) {
                    joinARoom(message);
                    return;
                }
            }

            if (message.message.shiftedModerationControl) {
                if (!message.message.firedOnLeave) {
                    onMessageCallback(message);
                    return;
                }
                shiftRoomControl[message.sender] = message;
                return;
            }

            // for v3 backward compatibility; >v3.3.3 no more uses below block
            if (message.remoteUserId == 'system') {
                if (message.message.detectPresence) {
                    if (message.message.userid === socket.userid) {
                        callback(false, socket.userid);
                        return;
                    }

                    callback(!!listOfUsers[message.message.userid], message.message.userid);
                    return;
                }
            }

            onMessageCallback(message);
        });

        socket.on('disconnect', function() {
            if (socket && socket.namespace && socket.namespace.sockets) {
                delete socket.namespace.sockets[this.id];
            }

            var message = shiftRoomControl[socket.userid];

            if (message) {
                delete shiftRoomControl[message.userid];
                onMessageCallback(message);
            }

            var firstUserSocket = null;

            getMyRoomSockets(socket).forEach(function(s) {
                if (!firstUserSocket) {
                    firstUserSocket = s;
                }

                s.emit('user-disconnected', socket.userid);
            });

            if (socket.shiftModerationControlBeforeLeaving && firstUserSocket) {
                firstUserSocket.emit('become-next-modrator', sessionid);
            }

            var user = listOfUsers[socket.userid];
            if (user && user.roomid && listOfRooms[user.roomid]) {
                var room = listOfRooms[user.roomid];
                if (room.initiator === socket.userid && !socket.shiftModerationControlBeforeLeaving) {
                    getMyRoomSockets(socket).forEach(function(s) {
                        s.emit('closed-entire-session', socket.userid, user.extra || {});
                    });
                } else {
                    var newArray = [];
                    getMyRoomSockets(socket).forEach(function(s) {
                        if (s.userid === socket.userid) return;
                        newArray.push(s.userid);
                    });
                    listOfRooms[user.roomid].participants = newArray;
                }
            }

            delete listOfUsers[socket.userid];
        });

        if (socketCallback) {
            socketCallback(socket);
        }
    }
};
