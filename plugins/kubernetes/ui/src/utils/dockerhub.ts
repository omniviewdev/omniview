// ============================================ DOCKER HUB ============================================ //

interface DockerHubRepository {
  user: string;
  name: string;
  namespace: string;
  repository_type: string;
  status: number;
  status_description: string;
  description: string;
  is_private: boolean;
  is_automated: boolean;
  star_count: number;
  pull_count: number;
  last_updated: string;
  date_registered: string;
  collaborator_count: number;
  hub_user: string;
  has_starred: boolean;
  full_description: string;
  permissions: DHPermissions;
  media_types: string[];
  content_types: string[];
  categories: DHCategory[];
}

interface DHPermissions {
  read: boolean;
  write: boolean;
  admin: boolean;
}

interface DHCategory {
  name: string;
  slug: string;
}

export interface DHOrg {
  id: string;
  orgname: string;
  full_name: string;
  location: string;
  company: string;
  profile_url: string;
  date_joined: string;
  gravatar_url: string;
  gravatar_email: string;
  type: string;
  badge: string;
  is_active: boolean;
}

// ====================================================== GENERIC =================================================== //

type JSONResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export type ImageRepositoryInfo = {
  user: string;
  name: string;
  shortDescription: string;
  description: string;
  status: string;
  private: boolean;
  automated: boolean;
  starCount: number;
  pullCount: number;
  collaboratorCount: number;
  updatedAt: string;
  registeredAt: string;
  logoSources: string[];
  categories: string[];
};

async function performFetch<T>(url: string): Promise<T | undefined> {
  const response = await fetch(url, { mode: "no-cors" });
  if (!response.ok) {
    return undefined;
  }

  const data: JSONResponse<T> = await response.json();
  return data.data;
}

export const getDockerHubImageInfo = async (image: string) => {
  image = image.replace("docker.io/", "");
  let [user, name] = image.split("/");
  if (!name) {
    // this is a library image
    name = user;
    user = "library";
  }

  try {
    const [repo, org] = await Promise.all([
      performFetch<DockerHubRepository>(
        `https://hub.docker.com/v2/repositories/${user}/${name}/`,
      ),
      performFetch<DHOrg>(`https://hub.docker.com/v2/orgs/${user}/`),
    ]);

    return {
      user: repo?.user || "",
      name: repo?.name || "",
      shortDescription: repo?.description || "",
      description: repo?.full_description || "",
      status: repo?.status_description || "",
      private: repo?.is_private || false,
      automated: repo?.is_automated || false,
      starCount: repo?.star_count || 0,
      pullCount: repo?.pull_count || 0,
      collaboratorCount: repo?.collaborator_count || 0,
      updatedAt: repo?.last_updated || "",
      registeredAt: repo?.date_registered || "",
      logoSources: [
        `https://hub.docker.com/api/media/repos_logo/v1/${user}%2F${name}`,
        org?.gravatar_url,
      ],
      categories: repo?.categories.map((c) => c.name) || [],
    } as ImageRepositoryInfo;
  } catch (error) {
    console.error(error);
    return null;
  }
};
