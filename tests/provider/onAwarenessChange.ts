import test from "ava";
import { newHocuspocus, newHocuspocusProvider, sleep } from "../utils/index.ts";

test("onAwarenessChange callback is executed", async (t) => {
	await new Promise(async (resolve) => {
		const server = await newHocuspocus();

		const provider = newHocuspocusProvider(server, {
			onConnect() {
				provider.setAwarenessField("foo", "bar");
			},
			onAwarenessChange: ({ states }) => {
				t.is(states.length, 1);
				t.is(states[0].foo, "bar");

				resolve("done");
			},
		});
	});
});

test("onAwarenessChange callback is executed, even when no awareness fields are set", async (t) => {
	await new Promise(async (resolve) => {
		const server = await newHocuspocus();

		const provider = newHocuspocusProvider(server, {
			onAwarenessChange: ({ states }) => {
				t.is(states.length, 2);

				resolve("done");
			},
		});

		const anotherProvider = newHocuspocusProvider(server, {
			async onConnect() {
				anotherProvider.setAwarenessField("foo", "bar");
				provider.configuration.websocketProvider.connect();
			},
		});
	});

	t.pass();
});

test("onAwarenessChange callback is executed on provider destroy", async (t) => {
	await new Promise(async (resolve) => {
		const server = await newHocuspocus();

		const provider = newHocuspocusProvider(
			server,
			{
				onConnect() {
					provider.destroy();
				},
				onAwarenessChange: ({ states }) => {
					t.is(states.length, 0);
					resolve("done");
				},
			},
			{
				maxAttempts: 1,
			},
		);
	});
});

test("gets the current awareness states from the server", async (t) => {
	await new Promise(async (resolve) => {
		const server = await newHocuspocus();

		const provider = newHocuspocusProvider(server);
		const provider2 = newHocuspocusProvider(server, {
			onAwarenessChange: ({ states }) => {
				const state = states.find((state) => state.foo === "bar");

				if (state && state.foo === "bar") {
					t.pass();
					resolve("done");
				}
			},
		});

		provider.setAwarenessField("foo", "bar");
	});
});

test("shares awareness state with other users", async (t) => {
	await new Promise(async (resolve) => {
		const server = await newHocuspocus();

		const provider = newHocuspocusProvider(server, {
			onConnect() {
				provider.setAwarenessField("name", "player1");
			},
			onAwarenessChange: ({ states }) => {
				const player2 = !!states.filter((state) => state.name === "player2")
					.length;

				if (player2) {
					t.is(player2, true);
					resolve("done");
				}
			},
		});

		const anotherProvider = newHocuspocusProvider(server, {
			onConnect() {
				anotherProvider.setAwarenessField("name", "player2");
			},
			onAwarenessChange: ({ states }) => {
				const player1 = !!states.filter((state) => state.name === "player1")
					.length;

				if (player1) {
					t.is(player1, true);
				}
			},
		});
	});
});

test("does not share awareness state with users in other documents", async (t) => {
	await new Promise(async (resolve) => {
		const server = await newHocuspocus();

		newHocuspocusProvider(server, {
			async onConnect() {
				await sleep(100);

				t.pass();
				resolve("done");
			},
			onAwarenessChange: ({ states }) => {
				const player2 = !!states.filter((state) => state.name === "player2")
					.length;

				if (player2) {
					t.fail("Awareness state leaked!");
				}
			},
		});

		const anotherProvider = newHocuspocusProvider(server, {
			name: "completely-different-and-unrelated-document",
			onConnect() {
				anotherProvider.setAwarenessField("name", "player2");
			},
		});
	});
});
