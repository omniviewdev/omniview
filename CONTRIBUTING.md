# Contributing to Omniview

Thank you for your interest in contributing to Omniview! We're thrilled to welcome contributors who are passionate about improving the DevOps experience through this innovative IDE. Our community thrives on the diverse ideas and contributions that help make Omniview not just a tool, but a revolution in DevOps engineering.

To ensure a positive and inclusive experience for everyone, we adhere to a [Code of Conduct](CODE_OF_CONDUCT.md). We encourage all participants to read and follow these guidelines to foster a constructive and respectful community.

## Ways to Contribute

Omniview is more than just software; it's a movement towards a more integrated, efficient, and intuitive way of managing infrastructure. Here's how you can be a part of this journey:

- **Enhance the Plugin System**: Dive into our extensible plugin architecture to add new functionalities or improve existing ones.
- **Boost Performance**: Help us optimize Omniview for speed, efficiency, and scalability.
- **Share Your Expertise**: Write articles, tutorials, or documentation to help others navigate and make the most of Omniview.
- **Spread the Word**: Organize meetups, webinars, or tutorials to introduce more people to Omniview's capabilities.
- **Provide Feedback**: Your experiences and suggestions can help shape the future of Omniview. Let us know how we can improve.

## Reporting Bugs

Found a glitch? Help us smooth out the experience by reporting bugs. Before you do, take a moment to check our [issue tracker](https://github.com/omniviewdev/omniview/issues) to see if the issue has already been reported. If it's new, [create a bug report](https://github.com/omniviewdev/omniview/issues/new?assignees=&labels=bug&template=bug_report.md) providing as much detail as possible to help us replicate and tackle the issue.

## Suggesting Enhancements

We're always looking for ways to make Omniview better. If you have ideas for new features or improvements, we're all ears! [Submit a feature request](https://github.com/omniview/omniview/issues/new?assignees=&labels=enhancement&template=feature_request.md) to share your vision.

## Security Issues

If you discover a security vulnerability within Omniview, please follow our [security policy](https://github.com/omniview/omniview/security/policy) to report it responsibly.

## Your First Contribution

Unsure where to start? Look for issues tagged with `good first issue`—these are great for newcomers. Our [documentation](https://omniview.dev/docs) and the community on [Discord](https://discord.gg/omniview) can also offer guidance and support as you make your first steps.

## Contribution Guidelines

- **Pull Requests**: For any contribution, small or large, submit a pull request with a clear description of the changes. This makes it easier for us to merge your contributions efficiently.
- **Coding Standards**: Follow our coding standards to ensure consistency and maintainability. Details can be found in our [developer's guide](contribute/developer-guide.md).
- **Testing**: Adding tests for new features or fixing bugs increases the stability of Omniview. We love tests!
- **Documentation**: If your changes need documentation, please update it. Good documentation is key to user adoption.

## Working with Forks and Submodules

Omniview uses Git submodules for first-party plugins (e.g. `plugins/kubernetes`). If you're developing across a fork of the parent repo **and** a fork of a plugin, follow this workflow carefully to avoid polluting PRs with submodule URL changes.

### Repository layout

| Repo | Canonical location |
|------|--------------------|
| Parent app | `github.com/omniviewdev/omniview` |
| Kubernetes plugin | `github.com/omniviewdev/omniview-plugin-kubernetes` |

### Setting up your forks locally

After cloning your fork of the parent repo, the submodule will point to the canonical upstream URL (as defined in `.gitmodules`). Add your plugin fork as a second remote inside the submodule so you can push feature branches there:

```bash
cd plugins/kubernetes
git remote add upstream git@github.com:omniviewdev/omniview-plugin-kubernetes.git
# "origin" already points to the canonical upstream after a normal clone
# add your fork as a push target:
git remote set-url --push origin git@github.com:<your-username>/omniview-plugin-kubernetes.git
```

To redirect your local checkout to pull from your fork without touching `.gitmodules` (which is committed and shared):

```bash
# Run from the root of the parent repo
git config submodule.plugins/kubernetes.url git@github.com:<your-username>/omniview-plugin-kubernetes.git
```

This writes only to your local `.git/config` and is never committed.

### Developing a plugin change

1. Branch off your plugin fork, do your work, push to your fork, open a PR to `omniviewdev/omniview-plugin-kubernetes`.
2. While waiting for the plugin PR to merge you can point your local submodule at your feature branch commit for integration testing — but **never commit a `.gitmodules` change** that points to a personal fork.
3. Once the plugin PR is merged, advance the submodule pointer in the parent repo:

```bash
cd plugins/kubernetes
git fetch upstream
git checkout upstream/main

cd ..
git add plugins/kubernetes
git commit -m "chore: update kubernetes submodule to upstream main (<short-sha>)"
```

4. Open a PR to `omniviewdev/omniview` with just the submodule pointer bump.

### Syncing your fork after upstream merges

After any PR is merged into the upstream parent repo, sync your fork's `main`:

```bash
git fetch upstream
git merge upstream/main
git push origin main
```

Then check the submodule too — if `git submodule status` shows a `-` or `+` prefix the pointer is out of sync:

```bash
cd plugins/kubernetes
git fetch upstream
git checkout upstream/main

cd ..
git add plugins/kubernetes
git commit -m "chore: update kubernetes submodule to upstream main (<short-sha>)"
git push origin main
```

### The rule that prevents collisions

> **`.gitmodules` must always reference the canonical upstream URL.** Never open a PR that changes a submodule URL to a personal fork. Use `git config submodule.<path>.url` for local overrides — these live in `.git/config` and are never committed.

To reset a local override back to the canonical URL at any time:

```bash
git submodule sync
```

## Signing the CLA

Before we can accept your contributions, you'll need to sign a Contributor License Agreement (CLA). This helps ensure that the community can always use your contributions.

## Ready to Contribute?

Check out the following resources to get started:

- [Development Environment Setup](contribute/developer-guide.md)
- [Plugin Development Guide](https://omniview.docs.io/plugins)
- [Contributing to Documentation](contribute/documentation.md)

Omniview is a community effort, and your contributions are a significant part of what makes this project special. Together, we're building the future of DevOps.

Thank you for contributing to Omniview!
