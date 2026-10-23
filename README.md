<br>

<p align="center">
    <a href="https://omniview.dev#gh-dark-mode-only" target="_blank">
        <img width="600" src="./img/logo.svg" alt="Omniview Logo">
    </a>
    <a href="https://omniview.dev#gh-light-mode-only" target="_blank">
        <img width="600" src="./img/logo.svg" alt="Omniview Logo">
    </a>
</p>

<h3 align="center">The future-proof, highly extendable IDE for DevOps engineering, transforming how you visualize, manage, and interact with your infrastructure.</h3>

<br>

<p align="center">
    <a href="https://github.com/omniviewdev/omniview"><img src="https://img.shields.io/github/v/release/omniviewdev/omniview?color=%23ff00a0&include_prereleases&label=version&sort=semver&style=flat-square"></a>
    &nbsp;
    <a href="https://github.com/omniviewdev/omniview"><img src="https://img.shields.io/badge/built_with-Go-007D9C.svg?style=flat-square"></a>
    &nbsp;
	<a href="https://github.com/omniviewdev/omniview/actions"><img src="https://img.shields.io/github/actions/workflow/status/omniviewdev/omniview/ci.yml?style=flat-square&branch=main"></a>
    &nbsp;
    <a href="https://github.com/omniviewdev/omniview/license"><img src="https://img.shields.io/badge/license-AGPL_3.0-00bfff.svg?style=flat-square"></a>
</p>

<p align="center">
    <a href="https://twitter.com/omniviewdev"><img src="https://img.shields.io/badge/twitter-follow_us-1d9bf0.svg?style=flat-square"></a>
    &nbsp;
    <a href="https://dev.to/omniview"><img src="https://img.shields.io/badge/dev-join_us-86f7b7.svg?style=flat-square"></a>
    &nbsp;
    <a href="https://www.linkedin.com/company/omniviewdev/"><img src="https://img.shields.io/badge/linkedin-connect_with_us-0a66c2.svg?style=flat-square"></a>
</p>

<p align="center">
        <img src="./img/preview.png" alt="Omniview Preview">
</p>


<h2>What is Omniview?</h2>

Omniview is a groundbreaking Integrated Development Environment (IDE) tailored specifically for DevOps engineers. It redefines the concept of infrastructure management by offering a unified platform to visualize, manage, and operate across clouds, environments, and hosting platforms. Inspired by the principles of extensibility and efficiency, Omniview integrates seamlessly with your existing tools, enhancing them with a powerful plugin system that propels your operational workflow into the future.

## Key Features

- **Unified Interface**: A singular, intuitive gateway to manage your entire infrastructure landscape.
- **Extensible Plugin System**: Tailor Omniview to your needs, leveraging an ecosystem of plugins for comprehensive infrastructure management.
- **Cross-Cloud Compatibility**: Seamlessly integrate with AWS, Azure, Google Cloud, and more, for a truly unified cloud management experience.
- **Kubernetes and Cloud-Native Support**: First-class support for Kubernetes and cloud-native technologies, ensuring that you're equipped for the future of infrastructure.
- **Real-Time Visualization**: Dive deep into your infrastructure with dynamic, real-time visualizations that bring clarity to complex environments.

## Why Omniview?

In the fast-paced world of DevOps, engineers need tools that are not only powerful but also adaptable and intuitive. Omniview bridges the gap between complexity and usability, offering a platform that grows with you. It's not just about managing infrastructure; it's about empowering DevOps engineers with a workflow that’s as innovative as they are.

## Getting Started

To begin transforming your DevOps experience with Omniview, follow these steps:

1. **Install Omniview**: Download the latest version from our [releases page](https://github.com/omniviewdev/omniview/releases).
2. **Explore Plugins**: Dive into our plugin ecosystem and customize your environment. [Discover plugins](https://omniview.dev/plugins).
3. **Connect Your Infrastructure**: Easily connect Omniview to your cloud and hosting platforms, setting up your unified workspace.
4. **Enjoy Unified DevOps**: Start managing and visualizing your infrastructure like never before.

### Plugin compatibility

This build's UI runs on `@omniviewdev/base-ui` and no longer ships MUI, Emotion or the legacy `@omniviewdev/ui` design system to plugins. Plugins whose UI still imports those packages (older releases from the upstream marketplace) will not load; use plugin releases built against base-ui.

For contributors: resource-toolbar controls should consistently request `size="sm"` and rely on the shared density scale rather than fixed pixel heights.

The titlebar search owns a flexible 500px preferred-width region; adjacent header regions share the remaining width. Keep sizing on the region rather than imposing a minimum width on the input, so narrow windows can shrink without clipping decorators.

Plugin imports of `@omniviewdev/base-ui/styles.css` must resolve through `ui/theme/base-ui.css`, the same layered entry used by the host. Loading the package stylesheet directly a second time bypasses the cascade layer and can override host component sizing and spacing after plugin startup.

Compact filter popovers use `size="sm"` and let the shared popup own outer padding and inter-section gaps. Group headings and controls into sections instead of adding another padded surface inside the popup.

### Developing against published UI patches

`task dev` starts an explicitly selected development workspace; it no longer mutates dependency versions implicitly. Use `task ui:update` separately to refresh published Base UI, AI UI, and Editors within their declared ranges, then review and commit intended lockfile changes.

Named workspaces use selected local source overlays rather than consuming unpublished sibling changes accidentally. Running `pnpm dev` directly starts only Vite, not an isolated host. See [development workspaces](docs/development-workspaces.md) and the [native toolchain](docs/development-native-toolchain.md) for explicit state selection and bootstrap-aware Go commands.

The root manifest’s `packageManager` field is the single pnpm version source for local development and GitHub Actions. Workflow setup steps intentionally omit a separate pnpm version. CI and release workflows continue using frozen lockfile installs; review and commit intended lockfile changes from development.

`task check:ui-typecheck` checks application and test programs separately. The test configuration explicitly loads React diagnostic augmentation types, so component flags such as `whyDidYouRender` do not depend on unrelated imports being present.

## Documentation

For detailed instructions, tutorials, and API documentation, visit our [official documentation](https://docs.omniview.dev/docs/introduction).

## Community and Support

Join the growing community of Omniview users and contributors! For support, discussion, and sharing insights:

- [Discord](https://discord.gg/omniview) - Join our Discord server for live discussions.
- [GitHub Issues](https://github.com/omniviewdev/omniview/issues) - Report bugs or request features directly through our GitHub issues.

## Contributing

We welcome contributions from the community! If you're interested in making Omniview even better, check out our [contributing guidelines](https://github.com/omniviewdev/omniview/blob/main/CONTRIBUTING.md) for more information on getting started.

## License

Omniview is open-source software licensed under the [AGPL-3.0 License](https://github.com/omniviewdev/omniview/blob/main/LICENSE).

---

Transform your DevOps workflow today with **Omniview** - the extendable IDE where innovation meets infrastructure.
