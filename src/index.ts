
export interface Env {
	// Set these secrets via Wrangler (wrangler secret put ...)
	GITHUB_TOKEN: string;
	TODOIST_TOKEN: string;
}

interface GitHubIssue {
	id: number;
	number: number;
	title: string;
	html_url: string;
	body: string | null;
}

interface TodoistTask {
	id: number;
	content: string;
	description?: string;
}

// Fetch GitHub issues using the GitHub Search Issues API
async function fetchGitHubIssues(githubToken: string): Promise<GitHubIssue[]> {
	const url = "https://api.github.com/issues";
	const request: RequestInit = {
		method: "GET",
		headers: {
			Authorization: `token ${githubToken}`,
			"Accept": "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "gh-to-todoist-Worker"
		}
	};
	const response = await fetch(url, request);
	if (!response.ok) {
		throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
	}
	const data =  await response.json();
	return data as GitHubIssue[];
}

// Retrieve all active Todoist tasks using the Todoist REST API
async function getTodoistTasks(todoistToken: string): Promise<TodoistTask[]> {
	const url = "https://api.todoist.com/rest/v2/tasks";
	const response = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${todoistToken}`,
			"User-Agent": "gh-to-todoist-Worker"
		},
	});

	if (!response.ok) {
		throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	return data as TodoistTask[];
}

// Check if a Todoist task already exists for the given GitHub issue
function taskExistsForIssue(issue: GitHubIssue, tasks: TodoistTask[]): boolean {
	return tasks.some(task => task.description && task.description.includes(issue.html_url));
}

// Create a new Todoist task for the given GitHub issue
async function createTodoistTask(issue: GitHubIssue, todoistToken: string): Promise<void> {
	const url = "https://api.todoist.com/rest/v2/tasks";
	const taskData = {
		content: issue.title,
		description: `GitHub Issue: ${issue.html_url}\n\n${issue.body || ""}`,
	};

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${todoistToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(taskData),
	});

	if (!response.ok) {
		const errorData = await response.text();
		throw new Error(`Error creating Todoist task: ${response.status} ${response.statusText} - ${errorData}`);
	}
}

export default {
	// The scheduled event handler (triggered by cron)
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		const githubToken = env.GITHUB_TOKEN;
		const todoistToken = env.TODOIST_TOKEN;

		console.log("Fetching GitHub issues");
		let issues: GitHubIssue[];
		try {
			issues = await fetchGitHubIssues(githubToken);
		} catch (err) {
			console.error("Error fetching GitHub issues:", err);
			return;
		}

		if (!issues || issues.length === 0) {
			console.log("No GitHub issues found for the given query.");
			return;
		}

		let todoistTasks: TodoistTask[];
		try {
			todoistTasks = await getTodoistTasks(todoistToken);
		} catch (err) {
			console.error("Error fetching Todoist tasks:", err);
			return;
		}

		for (const issue of issues) {
			if (taskExistsForIssue(issue, todoistTasks)) {
				console.log(`Skipping issue #${issue.number} as it already exists in Todoist.`);
				continue;
			}
			try {
				await createTodoistTask(issue, todoistToken);
				console.log(`Created Todoist task for issue #${issue.number}: ${issue.title}`);
			} catch (err) {
				console.error(`Error creating Todoist task for issue #${issue.number}:`, err);
			}
		}

		console.log("Sync complete.");
	},

	// Optional: HTTP endpoint to manually trigger the sync
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			await this.scheduled({} as ScheduledEvent, env, ctx);
			return new Response("Sync completed.", { status: 200 });
		} catch (err) {
			return new Response("Error during sync: " + err, { status: 500 });
		}
	}
};
