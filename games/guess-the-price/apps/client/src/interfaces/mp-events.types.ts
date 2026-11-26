export enum IncomingEvents {
	PLAYER_JOIN_SESSION = 'join-session',
	HOST_STARTS_ROUND = 'start-round',
	PLAYER_GUESS_PRICE = 'guess-price',
	HOST_SHOW_SESSION_RESULTS = 'session-results',
	HOST_END_SESSION = 'end-session',
	HOST_RESTART_SESSION = 'restart-session',
	HOST_TERMINATE_SESSION = 'terminate-session',
	PLAYER_RECONNECT = 'reconnect',
}

export enum OutgoingEvents {
	EXCEPTION = 'exception',
	SESSION_DETAILS = 'session:details',
	PLAYER_JOINS_SESSION = 'player:joins',
	PLAYER_GUESS = 'player:guess',
	PLAYER_LEAVES = 'player:leaves',
	PLAYER_RECONNECTS = 'player:reconnects',
	ROUND_STARTS = 'round:start',
	ROUND_ENDS = 'round:ends',
	SESSION_SHOW_RESULTS = 'session:results',
	SESSION_ENDS = 'session:ends',
	SESSION_RESTARTS = 'session:restart',
	SESSION_TERMINATE = 'session:terminated',
	HOST_CHANGED = 'host:changed',
}
